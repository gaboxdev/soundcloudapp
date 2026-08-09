use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::hash::{BuildHasher, Hasher};
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};
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
const LOGIN_URL: &str = "https://soundcloud.com/signin";
const LOGOUT_URL: &str = "https://soundcloud.com/logout";
const RESULT_SCHEME: &str = "slbridge";
const HTTP_TIMEOUT: Duration = Duration::from_secs(15);
const HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const BRIDGE_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_ASSET_BUNDLES: usize = 6;

static POPUP_COUNTER: AtomicUsize = AtomicUsize::new(0);
static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(1);

static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .connect_timeout(HTTP_CONNECT_TIMEOUT)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
});

static BRIDGE_NONCE: LazyLock<String> = LazyLock::new(|| {
    let first = RandomState::new().build_hasher().finish();
    let second = RandomState::new().build_hasher().finish();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.subsec_nanos() as u64)
        .unwrap_or(0);
    format!("{:016x}{:016x}", first ^ now.rotate_left(17), second)
});

static SECRET_PATTERNS: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    [
        (r"(?i)(client_id=)[A-Za-z0-9_\-]+", "${1}oculto"),
        (r"(?i)(oauth_token=)[^&;\s]+", "${1}oculto"),
        (r"(?i)(OAuth\s+)[A-Za-z0-9._\-]+", "${1}oculto"),
        (r#"(?i)("client_id"\s*:\s*")[^"]*"#, "${1}oculto"),
        (r#"(?i)(client_id:")[^"]*"#, "${1}oculto"),
    ]
    .into_iter()
    .filter_map(|(pattern, replacement)| {
        Regex::new(pattern)
            .ok()
            .map(|compiled| (compiled, replacement))
    })
    .collect()
});

static CLIENT_ID_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r#""hydratable":"apiClient","data":\{"id":"([A-Za-z0-9]{16,64})""#,
        r#""apiClient"[\s\S]{0,300}?"id":"([A-Za-z0-9]{16,64})""#,
        r#"client_id:"([A-Za-z0-9]{16,64})""#,
    ]
    .into_iter()
    .filter_map(|pattern| Regex::new(pattern).ok())
    .collect()
});

static SCRIPT_CLIENT_ID_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r#"client_id:"([A-Za-z0-9]{16,64})""#,
        r#"client_id="([A-Za-z0-9]{16,64})""#,
        r#""client_id":"([A-Za-z0-9]{16,64})""#,
        r#"client_id=([A-Za-z0-9]{16,64})"#,
    ]
    .into_iter()
    .filter_map(|pattern| Regex::new(pattern).ok())
    .collect()
});

static ASSET_URL_PATTERN: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r#"https://a-v2\.sndcdn\.com/assets/[A-Za-z0-9._\-]+\.js"#).ok());

struct ClientIdState(Mutex<Option<(String, Instant)>>);

struct PendingRequest {
    id: u64,
    sender: oneshot::Sender<Result<String, String>>,
}

struct BridgeState {
    pending: Mutex<Option<PendingRequest>>,
    lock: tokio::sync::Mutex<()>,
    ready: AtomicBool,
}

impl BridgeState {
    fn arm(&self, id: u64, sender: oneshot::Sender<Result<String, String>>) {
        *lock_or_recover(&self.pending) = Some(PendingRequest { id, sender });
    }

    fn deliver(&self, id: u64, result: Result<String, String>) -> bool {
        let mut guard = lock_or_recover(&self.pending);
        let matches = guard.as_ref().map(|pending| pending.id == id) == Some(true);
        if !matches {
            return false;
        }
        match guard.take() {
            Some(pending) => pending.sender.send(result).is_ok(),
            None => false,
        }
    }

    fn disarm(&self, id: u64) {
        let mut guard = lock_or_recover(&self.pending);
        if guard.as_ref().map(|pending| pending.id == id) == Some(true) {
            guard.take();
        }
    }
}

fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

fn redact(message: &str) -> String {
    let mut result = message.to_string();
    for (pattern, replacement) in SECRET_PATTERNS.iter() {
        result = pattern.replace_all(&result, *replacement).into_owned();
    }
    result
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
        let _ = writeln!(file, "[{timestamp}] {}", redact(message));
    }
}

fn parse_query(query: &str) -> HashMap<String, String> {
    url::form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect()
}

fn query_of(url: &str) -> HashMap<String, String> {
    url.split_once('?')
        .map(|(_, query)| parse_query(query))
        .unwrap_or_default()
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
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
    let _ = app.emit("sl-session-check", ());
}

fn navigate_bridge(window: &WebviewWindow) {
    if let Ok(target) = BRIDGE_BASE_URL.parse::<Url>() {
        let _ = window.navigate(target);
    }
}

async fn wait_bridge_ready(window: &WebviewWindow, ready: &AtomicBool) -> bool {
    if ready.load(Ordering::SeqCst) {
        return true;
    }
    for attempt in 0..60 {
        if attempt % 20 == 0 {
            navigate_bridge(window);
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
        if ready.load(Ordering::SeqCst) {
            return true;
        }
    }
    false
}

async fn settle_bridge(window: &WebviewWindow, ready: &AtomicBool) {
    for _ in 0..40 {
        if ready.load(Ordering::SeqCst) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    debug_log("authed: el puente no volvió a soundcloud.com, renavegando");
    navigate_bridge(window);
    for _ in 0..30 {
        if ready.load(Ordering::SeqCst) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn default_app_base_url() -> String {
    #[cfg(target_os = "macos")]
    {
        "tauri://localhost".to_string()
    }
    #[cfg(not(target_os = "macos"))]
    {
        "http://tauri.localhost".to_string()
    }
}

fn app_base_url(app: &AppHandle) -> String {
    let Some(main) = app.get_webview_window("main") else {
        return default_app_base_url();
    };
    let Ok(url) = main.url() else {
        return default_app_base_url();
    };
    let Some(host) = url.host_str() else {
        return default_app_base_url();
    };
    let mut base = format!("{}://{}", url.scheme(), host);
    if let Some(port) = url.port() {
        base.push(':');
        base.push_str(&port.to_string());
    }
    base
}

fn bridge_result_url() -> String {
    #[cfg(any(windows, target_os = "android"))]
    {
        format!("http://{RESULT_SCHEME}.localhost/resultado")
    }
    #[cfg(not(any(windows, target_os = "android")))]
    {
        format!("{RESULT_SCHEME}://localhost/resultado")
    }
}

fn allow_popup(
    app: AppHandle,
) -> impl Fn(Url, NewWindowFeatures) -> NewWindowResponse<tauri::Wry> + Send + 'static {
    move |url, features| {
        let index = POPUP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let label = format!("{POPUP_PREFIX}-{index}");
        let builder = WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
            .title("")
            .window_features(features)
            .initialization_script(LOGIN_HINT_SCRIPT);
        match builder.build() {
            Ok(window) => NewWindowResponse::Create { window },
            Err(_) => NewWindowResponse::Deny,
        }
    }
}

fn first_match(patterns: &[Regex], haystack: &str) -> Option<String> {
    for pattern in patterns {
        if let Some(captures) = pattern.captures(haystack) {
            if let Some(id) = captures.get(1) {
                return Some(id.as_str().to_string());
            }
        }
    }
    None
}

fn extract_client_id(html: &str) -> Option<String> {
    first_match(&CLIENT_ID_PATTERNS, html)
}

fn extract_client_id_from_script(script: &str) -> Option<String> {
    first_match(&SCRIPT_CLIENT_ID_PATTERNS, script)
}

fn asset_script_urls(html: &str) -> Vec<String> {
    let Some(pattern) = ASSET_URL_PATTERN.as_ref() else {
        return Vec::new();
    };
    let mut urls: Vec<String> = Vec::new();
    for found in pattern.find_iter(html) {
        let url = found.as_str().to_string();
        if !urls.contains(&url) {
            urls.push(url);
        }
    }
    urls.reverse();
    urls.truncate(MAX_ASSET_BUNDLES);
    urls
}

async fn fetch_text(url: &str) -> Result<String, String> {
    let response = HTTP_CLIENT
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status().as_u16()));
    }
    response.text().await.map_err(|error| error.to_string())
}

async fn fetch_client_id() -> Result<String, String> {
    let html = fetch_text("https://soundcloud.com")
        .await
        .map_err(|error| format!("fetch soundcloud.com: {error}"))?;
    if let Some(id) = extract_client_id(&html) {
        return Ok(id);
    }
    let bundles = asset_script_urls(&html);
    debug_log(&format!(
        "client_id: patrón principal sin resultado, probando {} bundles",
        bundles.len()
    ));
    for bundle in bundles {
        match fetch_text(&bundle).await {
            Ok(script) => {
                if let Some(id) = extract_client_id_from_script(&script) {
                    debug_log("client_id: extraído de un bundle de a-v2.sndcdn.com");
                    return Ok(id);
                }
            }
            Err(error) => debug_log(&format!("client_id: bundle no accesible ({error})")),
        }
    }
    Err("no se pudo extraer client_id".to_string())
}

async fn resolve_client_id(state: &ClientIdState, refresh: bool) -> Result<String, String> {
    if !refresh {
        let guard = lock_or_recover(&state.0);
        if let Some((id, fetched_at)) = &*guard {
            if fetched_at.elapsed() < CLIENT_ID_TTL {
                return Ok(id.clone());
            }
        }
    }
    let id = fetch_client_id().await?;
    *lock_or_recover(&state.0) = Some((id.clone(), Instant::now()));
    Ok(id)
}

fn cached_client_id(app: &AppHandle) -> String {
    let state = app.state::<ClientIdState>();
    let guard = lock_or_recover(&state.0);
    guard
        .as_ref()
        .map(|(id, _)| id.clone())
        .unwrap_or_default()
}

#[tauri::command]
async fn get_client_id(
    state: State<'_, ClientIdState>,
    refresh: Option<bool>,
    force: Option<bool>,
) -> Result<String, String> {
    let refresh = refresh.unwrap_or(false) || force.unwrap_or(false);
    resolve_client_id(&state, refresh).await
}

#[tauri::command]
async fn refresh_client_id(state: State<'_, ClientIdState>) -> Result<String, String> {
    resolve_client_id(&state, true).await
}

#[tauri::command]
async fn proxy_fetch(url: String, state: State<'_, ClientIdState>) -> Result<String, String> {
    let mut final_url = url;
    if final_url.contains("api-v2.soundcloud.com") && !final_url.contains("client_id") {
        let client_id = resolve_client_id(&state, false).await?;
        let separator = if final_url.contains('?') { '&' } else { '?' };
        final_url.push(separator);
        final_url.push_str("client_id=");
        final_url.push_str(&client_id);
    }
    let response = HTTP_CLIENT
        .get(&final_url)
        .send()
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

fn json_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

fn build_login_script(client_id: Option<String>, base: &str) -> String {
    let mut script = String::new();
    if let Some(cid) = client_id {
        script.push_str(&format!(
            r#"(function(){{
var CID={cid_json};var BASE={base_json};
if(!CID||!BASE)return;
var done=false;
var misses=0;
window.__slSucceed=function(){{
if(done)return;done=true;
try{{document.title="sl-auth-done";}}catch(e){{}}
location.href=BASE+'/auth-login-complete';
}};
function authHeaders(){{
var h={{}};
try{{var cs=document.cookie.split("; "),i=0;
for(;i<cs.length;i++){{var kv=cs[i].indexOf("="),k=cs[i].slice(0,kv);
if(k==="oauth_token"){{h.Authorization="OAuth "+decodeURIComponent(cs[i].slice(kv+1));}}
}}
}}catch(e){{}}
return h;
}}
function check(){{
if(done)return;
fetch('https://api-v2.soundcloud.com/me?client_id='+CID,{{credentials:'include',headers:authHeaders()}})
.then(function(r){{
if(r.status===200){{window.__slSucceed();}}
else{{misses++;if(misses===5){{try{{document.title="sl-auth-"+r.status;}}catch(e){{}}}}
if(misses>=30){{clearInterval(best);setInterval(check,10000);misses=-999;}}
}}
}})
.catch(function(){{}});
}}
var best=setInterval(check,3000);setTimeout(check,500);
}})();
"#,
            cid_json = json_string(&cid),
            base_json = json_string(base),
        ));
    }
    script.push_str(&format!(
        r#"(function(){{
var BASE={base_json};
if(window.location.hostname!=="soundcloud.com")return;
var path=window.location.pathname;
var KEY="sl_login_close_hint";
var tip=path.indexOf("login")!==-1||path.indexOf("sign")!==-1;
if(tip&&!sessionStorage.getItem("sl_login_tip")){{
var el=document.createElement("div");
el.style.cssText="position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;background:#18181b;color:#f4f4f6;border:1px solid #ff5500;border-radius:10px;padding:10px 14px;font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.45);display:flex;align-items:center;gap:10px;";
el.innerHTML="Para entrar con Google o Apple puede pedirte un <strong>passkey</strong>, que no funciona en esta app. Usa <strong>email + contraseña</strong> (o «usar otra contraseña» en Google).";
var btn=document.createElement("button");
btn.textContent="Entendido";
btn.style.cssText="flex-shrink:0;background:#ff5500;color:#fff;border:none;border-radius:999px;padding:5px 12px;font:600 12px -apple-system,sans-serif;cursor:pointer;";
btn.onclick=function(){{try{{sessionStorage.setItem("sl_login_tip","1");}}catch(e){{}}el.remove();}};
el.appendChild(btn);
document.documentElement.appendChild(el);
return;
}}
if(tip)return;
try{{if(sessionStorage.getItem(KEY))return;}}catch(e){{}}
var el2=document.createElement("div");
el2.style.cssText="position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;background:#18181b;color:#f4f4f6;border:1px solid #2ecc71;border-radius:10px;padding:10px 14px;font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.45);display:flex;align-items:center;gap:10px;";
el2.innerHTML="¿Ya ves tu sesión de SoundCloud abierta? Cierra esta ventana y Soundlite te dejará entrar automáticamente.";
var btn2=document.createElement("button");
btn2.textContent="Entendido";
btn2.style.cssText="flex-shrink:0;background:#2ecc71;color:#fff;border:none;border-radius:999px;padding:5px 12px;font:600 12px -apple-system,sans-serif;cursor:pointer;";
btn2.onclick=function(){{try{{sessionStorage.setItem(KEY,"1");}}catch(e){{}}el2.remove();}};
el2.appendChild(btn2);
document.documentElement.appendChild(el2);
var contBtn=document.createElement("button");
contBtn.textContent="He iniciado sesión · Continuar →";
contBtn.style.cssText="position:fixed;right:14px;top:14px;z-index:2147483646;background:linear-gradient(135deg,#ff5500,#ff2d78);color:#fff;border:none;border-radius:999px;padding:10px 16px;font:600 13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.4);";
contBtn.onclick=function(){{
try{{sessionStorage.setItem(KEY,"1");}}catch(e){{}}
if(window.__slSucceed){{window.__slSucceed();}}
else if(BASE){{window.location.href=BASE+'/auth-login-complete';}}
}};
document.documentElement.appendChild(contBtn);
}})();
"#,
        base_json = json_string(base),
    ));
    script.push_str(LOGIN_HINT_SCRIPT);
    script
}

fn build_bridge_script(id: u64, url_json: &str, opts: &str, base: &str) -> String {
    let result_json = json_string(&format!(
        "{}?nonce={}",
        bridge_result_url(),
        BRIDGE_NONCE.as_str()
    ));
    let fallback_json = json_string(&format!("{base}/auth-bridge"));
    format!(
        "(function(){{var ID={id};var RESULT={result};var FALLBACK={fallback};var sent=false;\
function fallback(status,text){{if(sent)return;sent=true;try{{window.location.href=FALLBACK+'?id='+ID+'&status='+status+'&body='+encodeURIComponent(text);}}catch(e){{}}}}\
function deliver(status,text){{try{{fetch(RESULT+'&id='+ID+'&status='+status,{{method:'POST',body:text}}).then(function(r){{if(r&&r.ok){{sent=true;}}else{{fallback(status,text);}}}},function(){{fallback(status,text);}});}}catch(e){{fallback(status,text);}}}}\
var h={{}};try{{var cs=document.cookie.split('; '),i=0;for(;i<cs.length;i++){{var kv=cs[i].indexOf('='),k=cs[i].slice(0,kv);if(k==='oauth_token'){{h.Authorization='OAuth '+decodeURIComponent(cs[i].slice(kv+1));}}}}}}catch(e){{}}h['Content-Type']='application/json';\
fetch({url},{opts}).then(function(r){{return r.text().then(function(t){{deliver(r.status,t);}});}}).catch(function(e){{deliver(0,String(e));}});}})();",
        id = id,
        result = result_json,
        fallback = fallback_json,
        url = url_json,
        opts = opts,
    )
}

#[tauri::command]
async fn login_window(app: AppHandle, state: State<'_, ClientIdState>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LOGIN_LABEL) {
        debug_log("login_window: ventana existente, recargando y trayendo al frente");
        if let Ok(target) = LOGIN_URL.parse::<Url>() {
            let _ = window.navigate(target);
        }
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    let client_id = resolve_client_id(&state, false).await.ok();
    debug_log(&format!(
        "login_window: abriendo (client_id {}",
        if client_id.is_some() { "ok)" } else { "falló)" }
    ));
    let base = app_base_url(&app);
    debug_log(&format!("login_window: base {base}"));
    let script = build_login_script(client_id, &base);
    let app_for_page_load = app.clone();
    let app_for_events = app.clone();
    let login_url = LOGIN_URL
        .parse::<Url>()
        .map_err(|error| format!("URL de login inválida: {error}"))?;
    WebviewWindowBuilder::new(&app, LOGIN_LABEL, WebviewUrl::External(login_url))
        .title("Iniciar sesión con SoundCloud")
        .inner_size(1000.0, 760.0)
        .min_inner_size(720.0, 560.0)
        .center()
        .initialization_script(&script)
        .on_new_window(allow_popup(app.clone()))
        .on_page_load(move |_webview, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            let url = payload.url().to_string();
            debug_log(&format!("login_window: cargado {url:.120}"));
            if url.contains("auth-login-complete") {
                debug_log("login_window: sesión detectada, cerrando");
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
    let logout_url = LOGOUT_URL
        .parse::<Url>()
        .map_err(|error| format!("URL de cierre de sesión inválida: {error}"))?;
    if let Some(window) = app.get_webview_window(LOGIN_LABEL) {
        let _ = window.navigate(logout_url);
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    let app_for_events = app.clone();
    WebviewWindowBuilder::new(&app, LOGIN_LABEL, WebviewUrl::External(logout_url))
        .title("Cerrar sesión en SoundCloud")
        .inner_size(720.0, 560.0)
        .initialization_script(LOGIN_HINT_SCRIPT)
        .on_new_window(allow_popup(app.clone()))
        .on_page_load(move |_webview, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            debug_log(&format!(
                "logout_window: cargado {:.120}",
                payload.url().to_string()
            ));
        })
        .build()
        .map(|window| {
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Destroyed = event {
                    debug_log("logout_window: cerrada, re-verificando sesión");
                    close_login_windows_in(&app_for_events);
                }
            });
        })
        .map_err(|error| error.to_string())?;
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
    if !wait_bridge_ready(&window, &state.ready).await {
        debug_log("authed: puente no listo");
        return Err("puente de sesión no listo".to_string());
    }

    let base = app_base_url(&app);
    let method_json = serde_json::to_string(&method).map_err(|error| error.to_string())?;
    let url_json = serde_json::to_string(&url).map_err(|error| error.to_string())?;
    let has_body = match &body {
        Some(value) if !value.is_null() => true,
        _ => false,
    };
    let body_js = body
        .as_ref()
        .and_then(|value| (!value.is_null()).then(|| value))
        .and_then(|value| serde_json::to_string(value).ok())
        .unwrap_or_else(|| "null".into());

    let opts = if has_body {
        format!(
            "{{method:{method},credentials:'include',headers:h,body:{body}}}",
            method = method_json,
            body = body_js,
        )
    } else {
        format!(
            "{{method:{method},credentials:'include',headers:h}}",
            method = method_json,
        )
    };

    for attempt in 0..2 {
        let id = REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        state.arm(id, tx);

        let js = build_bridge_script(id, &url_json, &opts, &base);
        debug_log(&format!("authed: eval intento {} (id {id})", attempt + 1));
        if let Err(error) = window.eval(&js) {
            debug_log(&format!("authed: eval falló: {error}"));
            state.disarm(id);
            continue;
        }

        let result = tokio::time::timeout(BRIDGE_TIMEOUT, rx)
            .await
            .map_err(|_| "timeout del puente de sesión".to_string())
            .and_then(|inner| inner.map_err(|_| "puente de sesión cerrado".to_string()));
        state.disarm(id);

        let failure = match result {
            Ok(Ok(response)) => {
                debug_log(&format!(
                    "authed: respuesta id {id} ({} bytes)",
                    response.len()
                ));
                settle_bridge(&window, &state.ready).await;
                return Ok(response);
            }
            Ok(Err(error)) => error,
            Err(error) => error,
        };

        debug_log(&format!("authed: fallo id {id}: {failure}"));
        if attempt == 0 {
            state.ready.store(false, Ordering::SeqCst);
            navigate_bridge(&window);
            if !wait_bridge_ready(&window, &state.ready).await {
                return Err("puente de sesión no listo".to_string());
            }
            continue;
        }
        settle_bridge(&window, &state.ready).await;
        return Err(failure);
    }
    Err("no se pudo completar la petición autenticada".to_string())
}

#[tauri::command]
fn log_debug(message: String) {
    debug_log(&message);
}

fn cors_response(status: u16) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "POST, OPTIONS")
        .header("Access-Control-Allow-Headers", "*")
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(Vec::new())
        .unwrap_or_default()
}

pub fn run() {
    let bridge_state = Arc::new(BridgeState {
        pending: Mutex::new(None),
        lock: tokio::sync::Mutex::new(()),
        ready: AtomicBool::new(false),
    });
    let bridge_for_setup = bridge_state.clone();
    let bridge_for_protocol = bridge_state.clone();

    tauri::Builder::default()
        .manage(ClientIdState(Mutex::new(None)))
        .manage(bridge_state)
        .register_uri_scheme_protocol(RESULT_SCHEME, move |context, request| {
            if request.method() == "OPTIONS" {
                return cors_response(204);
            }
            if context.webview_label() != BRIDGE_LABEL {
                debug_log("bridge_result: origen no autorizado");
                return cors_response(403);
            }
            let query = request.uri().query().map(parse_query).unwrap_or_default();
            if query.get("nonce").map(String::as_str) != Some(BRIDGE_NONCE.as_str()) {
                debug_log("bridge_result: nonce inválido");
                return cors_response(403);
            }
            let id = query
                .get("id")
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(0);
            let status = query.get("status").cloned().unwrap_or_else(|| "0".into());
            let text = String::from_utf8_lossy(request.body()).into_owned();
            debug_log(&format!(
                "bridge_result: id {id} status {status} ({} bytes)",
                text.len()
            ));
            let result = if status == "0" {
                Err(text)
            } else {
                Ok(format!("{status}\n{text}"))
            };
            if !bridge_for_protocol.deliver(id, result) {
                debug_log("bridge_result: respuesta huérfana descartada");
            }
            cors_response(200)
        })
        .setup(move |app| {
            let state_for_window = bridge_for_setup.clone();
            let bridge_url = BRIDGE_BASE_URL
                .parse::<Url>()
                .map_err(|error| error.to_string())?;
            WebviewWindowBuilder::new(app, BRIDGE_LABEL, WebviewUrl::External(bridge_url))
                .title("")
                .inner_size(320.0, 240.0)
                .visible(false)
                .decorations(false)
                .skip_taskbar(true)
                .on_page_load(move |webview, payload| {
                    let url = payload.url().to_string();
                    if payload.event() == PageLoadEvent::Started {
                        state_for_window.ready.store(false, Ordering::SeqCst);
                        return;
                    }
                    if payload.event() != PageLoadEvent::Finished {
                        return;
                    }
                    if url.contains("auth-bridge") {
                        state_for_window.ready.store(false, Ordering::SeqCst);
                        let query = query_of(&url);
                        let id = query
                            .get("id")
                            .and_then(|value| value.parse::<u64>().ok())
                            .unwrap_or(0);
                        let status = query.get("status").cloned().unwrap_or_else(|| "0".into());
                        let body = query.get("body").cloned().unwrap_or_default();
                        debug_log(&format!(
                            "auth-bridge (navegación): id {id} status {status} ({} bytes)",
                            body.len()
                        ));
                        let result = if status == "0" {
                            Err(body)
                        } else {
                            Ok(format!("{status}\n{body}"))
                        };
                        if !state_for_window.deliver(id, result) {
                            debug_log("auth-bridge: respuesta huérfana descartada");
                        }
                        if let Ok(target) = BRIDGE_BASE_URL.parse::<Url>() {
                            let _ = webview.navigate(target);
                        }
                        return;
                    }
                    state_for_window
                        .ready
                        .store(url.contains("soundcloud.com"), Ordering::SeqCst);
                })
                .build()?;

            if std::env::var("SOUNDLITE_SELFTEST").is_ok() {
                debug_log("SELFTEST: comenzando");
                let app_for_test = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    match resolve_client_id(&app_for_test.state::<ClientIdState>(), false).await {
                        Ok(client_id) => debug_log(&format!(
                            "SELFTEST: client_id ok ({} caracteres)",
                            client_id.len()
                        )),
                        Err(error) => debug_log(&format!("SELFTEST: client_id error {error}")),
                    }
                    let url = format!(
                        "https://api-v2.soundcloud.com/me?client_id={}",
                        cached_client_id(&app_for_test)
                    );
                    let bridge_state: State<Arc<BridgeState>> = app_for_test.state();
                    match authed_request(
                        app_for_test.clone(),
                        bridge_state,
                        "GET".into(),
                        url.clone(),
                        None,
                    )
                    .await
                    {
                        Ok(response) => {
                            debug_log(&format!("SELFTEST: /me OK -> {} bytes", response.len()))
                        }
                        Err(error) => debug_log(&format!("SELFTEST: /me error -> {error}")),
                    }
                    if let Err(error) = login_window(app_for_test.clone(), app_for_test.state()).await
                    {
                        debug_log(&format!("SELFTEST: login_window error {error}"));
                    }
                    debug_log("SELFTEST: ventana de login abierta");
                    tokio::time::sleep(Duration::from_secs(6)).await;
                    if let Some(login_win) = app_for_test.get_webview_window(LOGIN_LABEL) {
                        let probe_base = app_base_url(&app_for_test);
                        let probe_base_json = json_string(&probe_base);
                        let me_url = format!(
                            "https://api-v2.soundcloud.com/me?client_id={}",
                            cached_client_id(&app_for_test)
                        );
                        let me_json = json_string(&me_url);
                        let js_simple = format!(
                            "fetch({me},{{credentials:'include'}}).then(r=>location.href={base}+'/sl-probe-a?status='+r.status).catch(e=>location.href={base}+'/sl-probe-a?status=0');",
                            me = me_json,
                            base = probe_base_json,
                        );
                        let _ = login_win.eval(&js_simple);
                        tokio::time::sleep(Duration::from_millis(1200)).await;
                        let js_ct = format!(
                            "fetch({me},{{method:'GET',credentials:'include',headers:{{'Content-Type':'application/json'}},body:null}}).then(r=>location.href={base}+'/sl-probe-b?status='+r.status).catch(e=>location.href={base}+'/sl-probe-b?status=0');",
                            me = me_json,
                            base = probe_base_json,
                        );
                        let _ = login_win.eval(&js_ct);
                        tokio::time::sleep(Duration::from_millis(1200)).await;
                        let js_auth = format!(
                            "(function(){{var h={{}};try{{var cs=document.cookie.split('; '),i=0;for(;i<cs.length;i++){{var kv=cs[i].indexOf('='),k=cs[i].slice(0,kv);if(k==='oauth_token'){{h.Authorization='OAuth '+decodeURIComponent(cs[i].slice(kv+1));}}}}}}catch(e){{}}fetch({me},{{credentials:'include',headers:h}}).then(r=>location.href={base}+'/sl-probe-c?token='+(h.Authorization?'Y':'N')+'&status='+r.status).catch(e=>location.href={base}+'/sl-probe-c?token=N&status=0');}})();",
                            me = me_json,
                            base = probe_base_json,
                        );
                        let _ = login_win.eval(&js_auth);
                        debug_log("SELFTEST: sondas del login window lanzadas");
                    }
                    tokio::time::sleep(Duration::from_millis(1500)).await;
                    if let Ok(response) = authed_request(
                        app_for_test.clone(),
                        app_for_test.state(),
                        "GET".into(),
                        url.clone(),
                        None,
                    )
                    .await
                    {
                        debug_log(&format!(
                            "SELFTEST: bridge /me justo después -> {} bytes",
                            response.len()
                        ));
                    }
                    tokio::time::sleep(Duration::from_secs(8)).await;
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
            refresh_client_id,
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
