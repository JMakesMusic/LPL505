use base64::Engine;
use midir::{MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::Emitter;
use tauri::State;

// ─── State ───────────────────────────────────────────────────────────────────

struct MidiState {
    output_conn: Mutex<Option<MidiOutputConnection>>,
    input_conn: Mutex<Option<MidiInputConnection<()>>>,
    // Keep a client alive so macOS CoreMIDI correctly updates devices natively via hot-plug
    _keepalive_in: Mutex<Option<MidiInput>>,
    _keepalive_out: Mutex<Option<MidiOutput>>,
}

#[derive(Serialize, Clone, Debug)]
struct MidiDevice {
    id: usize,
    name: String,
}

#[derive(Serialize, Clone, Debug)]
struct MidiBeat {
    bpm: u32,
    beat: u64,
    total_ticks: i64,
}

struct ClockState {
    tick_count: u32,
    total_ticks: i64,
    total_beats: u64,
    is_playing: bool,
    last_beat_time: Option<Instant>,
    bpm_ema: Option<f64>,
}

impl ClockState {
    fn new() -> Self {
        Self {
            tick_count: 0,
            total_ticks: 0,
            total_beats: 0,
            is_playing: false,
            last_beat_time: None,
            bpm_ema: None,
        }
    }

    fn reset_for_start(&mut self) {
        self.tick_count = 23;
        self.total_ticks = -1;
        self.total_beats = 0;
        self.is_playing = true;
        self.last_beat_time = None;
        self.bpm_ema = None;
    }

    fn reset_for_stop(&mut self) {
        self.tick_count = 0;
        self.total_ticks = 0;
        self.total_beats = 0;
        self.is_playing = false;
        self.last_beat_time = None;
        self.bpm_ema = None;
    }
}

// ─── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
fn list_midi_inputs() -> Result<Vec<MidiDevice>, String> {
    let midi_in = MidiInput::new("505fx-scan-in").map_err(|e| e.to_string())?;
    let ports = midi_in.ports();
    let devices: Vec<MidiDevice> = ports
        .iter()
        .enumerate()
        .filter_map(|(i, port)| {
            let name = midi_in.port_name(port).ok()?;
            Some(MidiDevice { id: i, name })
        })
        .collect();
    Ok(devices)
}

#[tauri::command]
fn list_midi_outputs() -> Result<Vec<MidiDevice>, String> {
    let midi_out = MidiOutput::new("505fx-scan-out").map_err(|e| e.to_string())?;
    let ports = midi_out.ports();
    let devices: Vec<MidiDevice> = ports
        .iter()
        .enumerate()
        .filter_map(|(i, port)| {
            let name = midi_out.port_name(port).ok()?;
            Some(MidiDevice { id: i, name })
        })
        .collect();
    Ok(devices)
}

#[tauri::command]
fn connect_midi_output(state: State<MidiState>, port_index: usize) -> Result<String, String> {
    // Drop existing connection first
    {
        let mut lock = state.output_conn.lock().map_err(|e| e.to_string())?;
        *lock = None;
    }

    let midi_out = MidiOutput::new("505fx-out").map_err(|e| e.to_string())?;
    let ports = midi_out.ports();
    let port = ports
        .get(port_index)
        .ok_or_else(|| format!("Invalid port index {}", port_index))?;
    let name = midi_out
        .port_name(port)
        .unwrap_or_else(|_| "Unknown".into());
    let conn = midi_out
        .connect(port, "505fx-output")
        .map_err(|e| e.to_string())?;
    let mut lock = state.output_conn.lock().map_err(|e| e.to_string())?;
    *lock = Some(conn);
    Ok(name)
}

#[tauri::command]
fn connect_midi_input(
    app: tauri::AppHandle,
    state: State<MidiState>,
    port_index: usize,
) -> Result<String, String> {
    // Drop existing input connection first (this closes the previous port)
    {
        let mut lock = state.input_conn.lock().map_err(|e| e.to_string())?;
        *lock = None;
    }

    let midi_in = MidiInput::new("505fx-in").map_err(|e| e.to_string())?;
    let ports = midi_in.ports();
    let port = ports
        .get(port_index)
        .ok_or_else(|| format!("Invalid port index {}", port_index))?;
    let name = midi_in.port_name(port).unwrap_or_else(|_| "Unknown".into());

    let app_handle = app.clone();
    let clock = Arc::new(Mutex::new(ClockState::new()));
    let conn = midi_in
        .connect(
            port,
            "505fx-input",
            move |_timestamp, message, _| {
                if message.is_empty() {
                    return;
                }
                let status = message[0];
                match status {
                    0xF8 => {
                        // Clock tick
                        let mut cs = clock.lock().unwrap();
                        if !cs.is_playing {
                            return;
                        }
                        cs.total_ticks += 1;
                        cs.tick_count += 1;
                        let ticks = cs.total_ticks;
                        let _ = app_handle.emit("midi-clock-tick", ticks);

                        if cs.tick_count >= 24 {
                            cs.tick_count = 0;
                            cs.total_beats += 1;
                            let now = Instant::now();
                            if let Some(last) = cs.last_beat_time {
                                let dur_ms =
                                    now.duration_since(last).as_secs_f64() * 1000.0;
                                if dur_ms > 0.0 {
                                    let instant_bpm = 60000.0 / dur_ms;
                                    cs.bpm_ema = Some(match cs.bpm_ema {
                                        Some(prev) => {
                                            // Large jump: reset immediately
                                            if ((instant_bpm - prev) / prev).abs()
                                                > 0.15
                                            {
                                                instant_bpm
                                            } else {
                                                prev * 0.6 + instant_bpm * 0.4
                                            }
                                        }
                                        None => instant_bpm,
                                    });
                                }
                            }
                            cs.last_beat_time = Some(now);
                            let bpm = cs
                                .bpm_ema
                                .map(|b| b.round() as u32)
                                .unwrap_or(0);
                            let _ = app_handle.emit(
                                "midi-beat",
                                MidiBeat {
                                    bpm,
                                    beat: cs.total_beats,
                                    total_ticks: cs.total_ticks,
                                },
                            );
                        }
                    }
                    0xFA => {
                        // Start
                        let mut cs = clock.lock().unwrap();
                        cs.reset_for_start();
                        let _ = app_handle.emit("midi-transport", "start");
                    }
                    0xFB => {
                        // Continue (distinct from Start)
                        let mut cs = clock.lock().unwrap();
                        cs.is_playing = true;
                        let _ = app_handle.emit("midi-transport", "continue");
                    }
                    0xFC => {
                        // Stop
                        let mut cs = clock.lock().unwrap();
                        cs.reset_for_stop();
                        let _ = app_handle.emit("midi-transport", "stop");
                    }
                    _ => {}
                }
            },
            (),
        )
        .map_err(|e| e.to_string())?;

    // Store connection in state (replaces leaked mem::forget)
    let mut lock = state.input_conn.lock().map_err(|e| e.to_string())?;
    *lock = Some(conn);

    Ok(name)
}

#[tauri::command]
fn disconnect_midi_input(state: State<MidiState>) -> Result<(), String> {
    let mut lock = state.input_conn.lock().map_err(|e| e.to_string())?;
    *lock = None;
    Ok(())
}

#[tauri::command]
fn disconnect_midi_output(state: State<MidiState>) -> Result<(), String> {
    let mut lock = state.output_conn.lock().map_err(|e| e.to_string())?;
    *lock = None;
    Ok(())
}

#[tauri::command]
fn send_midi_cc(state: State<MidiState>, channel: u8, cc: u8, value: u8) -> Result<(), String> {
    let mut lock = state.output_conn.lock().map_err(|e| e.to_string())?;
    if let Some(conn) = lock.as_mut() {
        let status = 0xB0 + (channel.min(15));
        conn.send(&[status, cc, value]).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("No MIDI output connected".to_string())
    }
}

#[tauri::command]
fn send_midi_pc(state: State<MidiState>, channel: u8, program: u8) -> Result<(), String> {
    let mut lock = state.output_conn.lock().map_err(|e| e.to_string())?;
    if let Some(conn) = lock.as_mut() {
        let status = 0xC0 + (channel.min(15));
        conn.send(&[status, program]).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("No MIDI output connected".to_string())
    }
}

#[tauri::command]
fn send_midi_note_on(state: State<MidiState>, channel: u8, note: u8, velocity: u8) -> Result<(), String> {
    let mut lock = state.output_conn.lock().map_err(|e| e.to_string())?;
    if let Some(conn) = lock.as_mut() {
        let status = 0x90 + (channel.min(15));
        conn.send(&[status, note.min(127), velocity.min(127)]).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("No MIDI output connected".to_string())
    }
}

#[tauri::command]
fn send_midi_note_off(state: State<MidiState>, channel: u8, note: u8) -> Result<(), String> {
    let mut lock = state.output_conn.lock().map_err(|e| e.to_string())?;
    if let Some(conn) = lock.as_mut() {
        let status = 0x80 + (channel.min(15));
        conn.send(&[status, note.min(127), 0]).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("No MIDI output connected".to_string())
    }
}

#[tauri::command]
fn save_template(path: String, data: String) -> Result<(), String> {
    std::fs::write(&path, &data).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_template(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    let buf = std::fs::read(&path).map_err(|e| e.to_string())?;

    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        _ => "application/octet-stream",
    };

    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
    Ok(format!("data:{};base64,{}", mime, b64))
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .manage(MidiState {
            output_conn: Mutex::new(None),
            input_conn: Mutex::new(None),
            _keepalive_in: Mutex::new(MidiInput::new("505fx-keepalive-in").ok()),
            _keepalive_out: Mutex::new(MidiOutput::new("505fx-keepalive-out").ok()),
        })
        .invoke_handler(tauri::generate_handler![
            list_midi_inputs,
            list_midi_outputs,
            connect_midi_output,
            connect_midi_input,
            disconnect_midi_input,
            disconnect_midi_output,
            send_midi_cc,
            send_midi_pc,
            send_midi_note_on,
            send_midi_note_off,
            save_template,
            load_template,
            read_file_base64,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

