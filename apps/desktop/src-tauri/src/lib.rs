use std::sync::Mutex;
use std::time::{Duration, Instant};

use regex::Regex;
use tauri::State;

const CLIENT_ID_TTL: Duration = Duration::from_secs(20 * 60);

struct ClientIdState(Mutex<Option<(String, Instant)>>);

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

pub fn run() {
    tauri::Builder::default()
        .manage(ClientIdState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![get_client_id, proxy_fetch])
        .run(tauri::generate_context!())
        .expect("error al ejecutar Soundlite");
}
