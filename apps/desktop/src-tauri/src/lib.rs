use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use regex::Regex;
use tauri::webview::{NewWindowFeatures, NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;
use url::Url;

const CLIENT_ID_TTL: Duration = Duration::from_secs(20 * 60);
const BRIDGE_LABEL: &str = "sl-bridge";
const BRIDGE_BASE_URL: &str = "https://soundcloud.com/robots.txt";
const LOGIN_LABEL: &str = "sl-login";
const POPUP_PREFIX: &str = "sl-popup";

static POPUP_COUNTER: AtomicUsize = AtomicUsize::new(0);

struct ClientIdState(Mutex<Option<(String, Instant)>>);

struct BridgeState(Mutex<Option<oneshot::Sender<Result<String, String>>>>);

fn close_login_windows_in(app: &AppHandle) {
    let labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|label| label.as_str() == LOGIN_LABEL || label.starts_with(POPUP_PREFIX))
        .cloned()
        .collect();
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
    }
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

#[tauri::command]
async fn login_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LOGIN_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(
        &app,
        LOGIN_LABEL,
        WebviewUrl::External("https://soundcloud.com/login".parse().unwrap()),
    )
    .title("Iniciar sesión con SoundCloud")
    .inner_size(1000.0, 760.0)
    .min_inner_size(720.0, 560.0)
    .center()
    .initialization_script(LOGIN_HINT_SCRIPT)
    .on_new_window(allow_popup(app.clone()))
    .build()
    .map(|window| {
        let app_for_events = app.clone();
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

    let ready = window
        .url()
        .ok()
        .map(|current| current.as_str().starts_with(BRIDGE_BASE_URL))
        .unwrap_or(false);
    if !ready {
        let _ = window.navigate(BRIDGE_BASE_URL.parse().unwrap());
        tokio::time::sleep(Duration::from_millis(600)).await;
    }

    let base = app
        .get_webview_window("main")
        .and_then(|main| main.url().ok())
        .map(|main| format!("{}//{}", main.scheme(), main.host_str().unwrap_or("localhost")))
        .unwrap_or_else(|| "tauri://localhost".to_string());

    let (tx, rx) = oneshot::channel();
    *state.0.lock().map_err(|_| "lock del puente".to_string())? = Some(tx);

    let method_json = serde_json::to_string(&method).map_err(|error| error.to_string())?;
    let url_json = serde_json::to_string(&url).map_err(|error| error.to_string())?;
    let body_js = match &body {
        Some(value) => serde_json::to_string(value).unwrap_or_else(|_| "null".into()),
        None => "undefined".into(),
    };
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
    window.eval(&js).map_err(|error| error.to_string())?;

    let result = tokio::time::timeout(Duration::from_secs(20), rx)
        .await
        .map_err(|_| "timeout del puente de sesión".to_string())?
        .map_err(|_| "puente de sesión cerrado".to_string())?;
    let _ = state.0.lock().map(|mut slot| slot.take());
    result
}

pub fn run() {
    let bridge_state = Arc::new(BridgeState(Mutex::new(None)));
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
                if let Some(tx) = state_for_window.0.lock().unwrap().take() {
                    let _ = tx.send(result);
                }
                let _ = webview.navigate(BRIDGE_BASE_URL.parse().unwrap());
            })
            .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_client_id,
            proxy_fetch,
            authed_request,
            login_window,
            logout_window,
            close_login_windows,
        ])
        .run(tauri::generate_context!())
        .expect("error al ejecutar Soundlite");
}
