use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use regex::Regex;
use tauri::webview::{NewWindowFeatures, NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::oneshot;
use url::Url;

const CLIENT_ID_TTL: Duration = Duration::from_secs(20 * 60);
const BRIDGE_LABEL: &str = "sl-bridge";
const BRIDGE_BASE_URL: &str = "https://soundcloud.com/robots.txt";
const LOGIN_LABEL: &str = "sl-login";
const POPUP_PREFIX: &str = "sl-popup";

static POPUP_COUNTER: AtomicUsize = AtomicUsize::new(0);

struct ClientIdState(Mutex<Option<(String, Instant)>>);

struct BridgeState {
    pending: Mutex<Option<oneshot::Sender<Result<String, String>>>>,
    lock: tokio::sync::Mutex<()>,
}

fn debug_log(message: &str) {
    let path = std::env::temp_dir().join("soundlite-debug.log");
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(metadata) = std::fs::metadata(&path) {
        if metadata.len() > 512 * 1024 {
            let _ = std::fs::remove_file(&path);
        }
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[{timestamp}] {message}");
    }
}

fn close_login_windows_in(app: &AppHandle) {
    let labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|label| label.as_str() == LOGIN_LABEL || label.starts_with(POPUP_PREFIX))
        .cloned()
        .collect();
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            debug_log(&format!("cerrando ventana {label}"));
            let _ = window.close();
        }
    }
    let _ = app.emit("sl-session-check", ());
}

async fn wait_bridge_ready(window: &WebviewWindow) -> bool {
    for _ in 0..16 {
        let is_ready = window
            .url()
            .ok()
            .map(|current| current.as_str().starts_with(BRIDGE_BASE_URL))
            .unwrap_or(false);
        if is_ready {
            return true;
        }
        let _ = window.navigate(BRIDGE_BASE_URL.parse().unwrap());
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    window
        .url()
        .ok()
        .map(|current| current.as_str().starts_with(BRIDGE_BASE_URL))
        .unwrap_or(false)
}

fn app_base_url(app: &AppHandle) -> String {
    app.get_webview_window("main")
        .and_then(|main| main.url().ok())
        .map(|main| format!("{}//{}", main.scheme(), main.host_str().unwrap_or("localhost")))
        .unwrap_or_else(|| "tauri://localhost".to_string())
}

fn allow_popup(
    app: AppHandle,
) -> impl Fn(Url, NewWindowFeatures) -> NewWindowResponse<tauri::Wry> + Send + 'static {
    move |url, features| {
        let index = POPUP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let label = format!("{POPUP_PREFIX}-{index}");
        let (width, height) = features
            .size()
            .map(|size| {
                (
                    size.width.clamp(320.0, 1200.0),
                    size.height.clamp(400.0, 1400.0),
                )
            })
            .unwrap_or((520.0, 600.0));
        let mut builder = WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
            .title("")
            .inner_size(width, height)
            .initialization_script(LOGIN_HINT_SCRIPT);
        if let Some(position) = features.position() {
            builder = builder.position(position.x, position.y);
        }
        match builder.build() {
            Ok(window) => NewWindowResponse::Create { window },
            Err(_) => NewWindowResponse::Deny,
        }
    }
}

fn extract_client_id(html: &str) -> Option<String> {
    let patterns = [
        Regex::new(r#""hydratable":"apiClient","data":\{"id":"([A-Za-z0-9]{16,64})""#).unwrap(),
        Regex::new(r#""apiClient"[\s\S]{0,300}?"id":"([A-Za-z0-9]{16,64})""#).unwrap(),
        Regex::new(r#"client_id:"([A-Za-z0-9]{16,64})""#).unwrap(),
    ];
    for pattern in &patterns {
        if let Some(captures) = pattern.captures(html) {
            if let Some(id) = captures.get(1) {
                return Some(id.as_str().to_string());
            }
        }
    }
    None
}

async fn fetch_client_id() -> Result<String, String> {
    let response = reqwest::get("https://soundcloud.com")
        .await
        .map_err(|error| format!("fetch soundcloud.com: {error}"))?;
    let html = response
        .text()
        .await
        .map_err(|error| format!("leer respuesta: {error}"))?;
    extract_client_id(&html).ok_or_else(|| "no se pudo extraer client_id".to_string())
}

#[tauri::command]
async fn get_client_id(state: State<'_, ClientIdState>) -> Result<String, String> {
    {
        let guard = state.0.lock().unwrap();
        if let Some((id, fetched_at)) = &*guard {
            if fetched_at.elapsed() < CLIENT_ID_TTL {
                return Ok(id.clone());
            }
        }
    }
    let id = fetch_client_id().await?;
    {
        let mut guard = state.0.lock().unwrap();
        *guard = Some((id.clone(), Instant::now()));
    }
    Ok(id)
}

#[tauri::command]
async fn proxy_fetch(url: String, state: State<'_, ClientIdState>) -> Result<String, String> {
    let mut final_url = url;
    if final_url.contains("api-v2.soundcloud.com") && !final_url.contains("client_id") {
        let client_id = get_client_id(state).await?;
        let separator = if final_url.contains('?') { '&' } else { '?' };
        final_url.push(separator);
        final_url.push_str("client_id=");
        final_url.push_str(&client_id);
    }
    let response = reqwest::get(&final_url)
        .await
        .map_err(|error| format!("fetch upstream: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("upstream HTTP {}", response.status().as_u16()));
    }
    response
        .text()
        .await
        .map_err(|error| format!("leer respuesta: {error}"))
}

const LOGIN_HINT_SCRIPT: &str = r#"(function(){
var HOSTS=["accounts.google.com","appleid.apple.com"];
var KEY="sl_login_hint_dismissed";
try{if(sessionStorage.getItem(KEY))return;}catch(e){}
function show(){
var host=window.location.hostname;
if(HOSTS.indexOf(host)===-1)return;
var el=document.createElement("div");
el.style.cssText="position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;background:#18181b;color:#f4f4f6;border:1px solid #ff5500;border-radius:10px;padding:10px 14px;font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.45);display:flex;align-items:center;gap:10px;";
el.innerHTML="Los passkeys no funcionan dentro de la app (limitación del sistema). Usa la opción de <strong>contraseña</strong> o <em>otras opciones</em> para iniciar sesión.";
var btn=document.createElement("button");
btn.textContent="Entendido";
btn.style.cssText="flex-shrink:0;background:#ff5500;color:#fff;border:none;border-radius:999px;padding:5px 12px;font:600 12px -apple-system,sans-serif;cursor:pointer;";
btn.onclick=function(){try{sessionStorage.setItem(KEY,"1");}catch(e){}el.remove();};
el.appendChild(btn);
document.documentElement.appendChild(el);
}
if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",show);}else{show();}
})();"#;

fn build_login_script(client_id: Option<String>, base: &str) -> String {
    let mut script = String::new();
    if let Some(cid) = client_id {
        script.push_str(&format!(
            r#"(function(){{
var CID={cid_json};var BASE={base_json};
if(!CID||!BASE)return;
var done=false;
function check(){{
if(done)return;
fetch('https://api-v2.soundcloud.com/me?client_id='+CID,{{credentials:'include'}})
.then(function(r){{if(r.status===200){{done=true;location.href=BASE+'/auth-login-complete';}}}})
.catch(function(){{}});
}}
setInterval(check,2000);check();
}})();
"#,
            cid_json = serde_json::to_string(&cid).unwrap(),
            base_json = serde_json::to_string(base).unwrap(),
        ));
    }
    script.push_str(
        r#"(function(){
if(window.location.hostname!=="soundcloud.com")return;
var path=window.location.pathname;
var KEY="sl_login_close_hint";
var tip=path.indexOf("login")!==-1||path.indexOf("sign")!==-1;
if(tip&&!sessionStorage.getItem("sl_login_tip")){
var el=document.createElement("div");
el.style.cssText="position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;background:#18181b;color:#f4f4f6;border:1px solid #ff5500;border-radius:10px;padding:10px 14px;font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.45);display:flex;align-items:center;gap:10px;";
el.innerHTML="Para entrar con Google o Apple puede pedirte un <strong>passkey</strong>, que no funciona en esta app. Usa <strong>email + contraseña</strong> (o «usar otra contraseña» en Google).";
var btn=document.createElement("button");
btn.textContent="Entendido";
btn.style.cssText="flex-shrink:0;background:#ff5500;color:#fff;border:none;border-radius:999px;padding:5px 12px;font:600 12px -apple-system,sans-serif;cursor:pointer;";
btn.onclick=function(){try{sessionStorage.setItem("sl_login_tip","1");}catch(e){}el.remove();};
el.appendChild(btn);
document.documentElement.appendChild(el);
return;
}
if(tip)return;
try{if(sessionStorage.getItem(KEY))return;}catch(e){}
var el2=document.createElement("div");
el2.style.cssText="position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;background:#18181b;color:#f4f4f6;border:1px solid #2ecc71;border-radius:10px;padding:10px 14px;font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.45);display:flex;align-items:center;gap:10px;";
el2.innerHTML="¿Ya ves tu sesión de SoundCloud abierta? Cierra esta ventana y Soundlite te dejará entrar automáticamente.";
var btn2=document.createElement("button");
btn2.textContent="Entendido";
btn2.style.cssText="flex-shrink:0;background:#2ecc71;color:#fff;border:none;border-radius:999px;padding:5px 12px;font:600 12px -apple-system,sans-serif;cursor:pointer;";
btn2.onclick=function(){try{sessionStorage.setItem(KEY,"1");}catch(e){}el2.remove();};
el2.appendChild(btn2);
document.documentElement.appendChild(el2);
})();
"#,
    );
    script.push_str(LOGIN_HINT_SCRIPT);
    script
}

#[tauri::command]
async fn login_window(app: AppHandle, state: State<'_, ClientIdState>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LOGIN_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    let client_id = get_client_id(state).await.ok();
    let base = app
        .get_webview_window("main")
        .and_then(|main| main.url().ok())
        .map(|main| format!("{}//{}", main.scheme(), main.host_str().unwrap_or("localhost")))
        .unwrap_or_else(|| "tauri://localhost".to_string());
    let script = build_login_script(client_id, &base);
    let app_for_page_load = app.clone();
    let app_for_events = app.clone();
    WebviewWindowBuilder::new(
        &app,
        LOGIN_LABEL,
        WebviewUrl::External("https://soundcloud.com/login".parse().unwrap()),
    )
    .title("Iniciar sesión con SoundCloud")
    .inner_size(1000.0, 760.0)
    .min_inner_size(720.0, 560.0)
    .center()
    .initialization_script(&script)
    .on_new_window(allow_popup(app.clone()))
    .on_page_load(move |_webview, payload| {
        if payload.event() == PageLoadEvent::Finished
            && payload.url().as_str().contains("auth-login-complete")
        {
            close_login_windows_in(&app_for_page_load);
        }
    })
    .build()
    .map(|window| {
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::Destroyed = event {
                close_login_windows_in(&app_for_events);
            }
        });
    })
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
async fn logout_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LOGIN_LABEL) {
        let _ = window.navigate("https://soundcloud.com/logout".parse().unwrap());
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        WebviewWindowBuilder::new(
            &app,
            LOGIN_LABEL,
            WebviewUrl::External("https://soundcloud.com/logout".parse().unwrap()),
        )
        .title("Cerrar sesión en SoundCloud")
        .inner_size(720.0, 560.0)
        .initialization_script(LOGIN_HINT_SCRIPT)
        .on_new_window(allow_popup(app.clone()))
        .build()
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn close_login_windows(app: AppHandle) -> Result<(), String> {
    close_login_windows_in(&app);
    Ok(())
}

#[tauri::command]
async fn authed_request(
    app: AppHandle,
    state: State<'_, Arc<BridgeState>>,
    method: String,
    url: String,
    body: Option<serde_json::Value>,
) -> Result<String, String> {
    let window = app
        .get_webview_window(BRIDGE_LABEL)
        .ok_or_else(|| "puente de sesión no disponible".to_string())?;
    debug_log(&format!("authed {method} {url}"));

    let _request_guard = state.lock.lock().await;
    if !wait_bridge_ready(&window).await {
        debug_log("authed: puente no listo");
        return Err("puente de sesión no listo".to_string());
    }

    let base = app_base_url(&app);
    let method_json = serde_json::to_string(&method).map_err(|error| error.to_string())?;
    let url_json = serde_json::to_string(&url).map_err(|error| error.to_string())?;
    let body_js = match &body {
        Some(value) => serde_json::to_string(value).unwrap_or_else(|_| "null".into()),
        None => "undefined".into(),
    };

    for attempt in 0..2 {
        let (tx, rx) = oneshot::channel();
        *state.pending.lock().map_err(|_| "lock del puente".to_string())? = Some(tx);

        let js = format!(
            "fetch({url},{opts}).then(r=>r.text().then(t=>location.href='{base}/auth-bridge?status='+r.status+'&body='+encodeURIComponent(t))).catch(e=>location.href='{base}/auth-bridge?status=0&body='+encodeURIComponent(String(e)));",
            url = url_json,
            opts = format!(
                "{{method:{method},credentials:'include',headers:{{'Content-Type':'application/json'}},body:{body}}}",
                method = method_json,
                body = body_js,
            ),
            base = base,
        );
        debug_log(&format!("authed: eval intento {}", attempt + 1));
        if let Err(error) = window.eval(&js) {
            debug_log(&format!("authed: eval falló: {error}"));
            let _ = state.pending.lock().map(|mut slot| slot.take());
            continue;
        }

        let result = tokio::time::timeout(Duration::from_secs(15), rx)
            .await
            .map_err(|_| "timeout del puente de sesión".to_string())
            .and_then(|inner| inner.map_err(|_| "puente de sesión cerrado".to_string()));
        let _ = state.pending.lock().map(|mut slot| slot.take());
        match result {
            Ok(Ok(response)) => {
                debug_log(&format!("authed: respuesta {response:.80}"));
                return Ok(response);
            }
            Ok(Err(error)) => {
                debug_log(&format!("authed: error del puente: {error}"));
                if attempt == 0 {
                    let _ = window.navigate(BRIDGE_BASE_URL.parse().unwrap());
                    tokio::time::sleep(Duration::from_millis(1200)).await;
                    continue;
                }
                return Err(error);
            }
            Err(timeout_error) => {
                debug_log(&format!("authed: {timeout_error}"));
                if attempt == 0 {
                    let _ = window.navigate(BRIDGE_BASE_URL.parse().unwrap());
                    tokio::time::sleep(Duration::from_millis(1200)).await;
                    continue;
                }
                return Err(timeout_error);
            }
        }
    }
    Err("no se pudo completar la petición autenticada".to_string())
}

#[tauri::command]
fn log_debug(message: String) {
    debug_log(&message);
}

pub fn run() {
    let bridge_state = Arc::new(BridgeState {
        pending: Mutex::new(None),
        lock: tokio::sync::Mutex::new(()),
    });
    let bridge_for_setup = bridge_state.clone();

    tauri::Builder::default()
        .manage(ClientIdState(Mutex::new(None)))
        .manage(bridge_state)
        .setup(move |app| {
            let state_for_window = bridge_for_setup.clone();
            WebviewWindowBuilder::new(
                app,
                BRIDGE_LABEL,
                WebviewUrl::External(BRIDGE_BASE_URL.parse().unwrap()),
            )
            .title("")
            .inner_size(320.0, 240.0)
            .visible(false)
            .decorations(false)
            .skip_taskbar(true)
            .on_page_load(move |webview, payload| {
                if payload.event() != PageLoadEvent::Finished {
                    return;
                }
                let url = payload.url().to_string();
                if !url.contains("auth-bridge") {
                    return;
                }
                let query: HashMap<String, String> = url
                    .split_once('?')
                    .map(|(_, query)| url::form_urlencoded::parse(query.as_bytes()).into_owned().collect())
                    .unwrap_or_default();
                let status = query.get("status").cloned().unwrap_or_else(|| "0".into());
                let body = query.get("body").cloned().unwrap_or_default();
                let result = if status == "0" {
                    Err(body)
                } else {
                    Ok(format!("{status}\n{body}"))
                };
                debug_log(&format!("auth-bridge recibido: {result:?}"));
                if let Some(tx) = state_for_window.pending.lock().unwrap().take() {
                    let _ = tx.send(result);
                }
                let _ = webview.navigate(BRIDGE_BASE_URL.parse().unwrap());
            })
            .build()?;

            if std::env::var("SOUNDLITE_SELFTEST").is_ok() {
                debug_log("SELFTEST: comenzando");
                let app_for_test = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    let client_id_state: State<ClientIdState> = app_for_test.state();
                    match get_client_id(client_id_state).await {
                        Ok(client_id) => debug_log(&format!("SELFTEST: client_id ok {client_id}")),
                        Err(error) => debug_log(&format!("SELFTEST: client_id error {error}")),
                    }
                    let url = format!(
                        "https://api-v2.soundcloud.com/me?client_id={}",
                        app_for_test
                            .state::<ClientIdState>()
                            .0
                            .lock()
                            .unwrap()
                            .as_ref()
                            .map(|(id, _)| id.clone())
                            .unwrap_or_default()
                    );
                    let bridge_state: State<Arc<BridgeState>> = app_for_test.state();
                    match authed_request(
                        app_for_test.clone(),
                        bridge_state,
                        "GET".into(),
                        url,
                        None,
                    )
                    .await
                    {
                        Ok(response) => {
                            debug_log(&format!("SELFTEST: /me OK -> {response:.150}"))
                        }
                        Err(error) => debug_log(&format!("SELFTEST: /me error -> {error}")),
                    }
                    if let Err(error) = login_window(app_for_test.clone(), app_for_test.state()).await {
                        debug_log(&format!("SELFTEST: login_window error {error}"));
                    }
                    debug_log("SELFTEST: ventana de login abierta");
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    let labels: Vec<String> = app_for_test
                        .webview_windows()
                        .keys()
                        .map(|label| label.clone())
                        .collect();
                    debug_log(&format!("SELFTEST: ventanas {labels:?}"));
                    close_login_windows_in(&app_for_test);
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    debug_log("SELFTEST: terminado");
                    app_for_test.exit(0);
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_client_id,
            proxy_fetch,
            authed_request,
            login_window,
            logout_window,
            close_login_windows,
            log_debug,
        ])
        .run(tauri::generate_context!())
        .expect("error al ejecutar Soundlite");
}
