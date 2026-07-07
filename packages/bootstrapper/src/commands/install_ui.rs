use crate::{
    cli::args::Args,
    commands::install_workflow::install_workflow_options_from_args,
    core::error::Result,
    domain::install_workflow::{
        InstallWorkflowOptions,
        events::{InstallProgressReporter, InstallWorkflowEvent},
        run_install_workflow,
    },
};
use eframe::egui;
use egui::{
    Color32, ColorImage, FontData, FontDefinitions, FontFamily, Label, Rect, RichText, Sense,
    Stroke, StrokeKind, TextureHandle, TextureOptions, UiBuilder, Vec2,
};
use serde_json::Value;
use std::{
    env,
    error::Error,
    fmt,
    sync::{
        Arc, Mutex,
        mpsc::{self, Receiver, Sender},
    },
    thread,
    time::{Duration, Instant},
};

const APP_ICON: &[u8] = include_bytes!("../../../../static/assets/icon/App.png");

#[derive(Debug)]
pub enum InstallUiError {
    Closed,
    Startup(String),
    Workflow(String),
}

impl fmt::Display for InstallUiError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Closed => write!(formatter, "install UI closed before install completed"),
            Self::Startup(error) => write!(formatter, "install UI could not start: {error}"),
            Self::Workflow(error) => write!(formatter, "install workflow failed: {error}"),
        }
    }
}

impl Error for InstallUiError {}

#[derive(Clone)]
struct ChannelInstallProgressReporter {
    sender: Sender<InstallWorkflowEvent>,
}

impl InstallProgressReporter for ChannelInstallProgressReporter {
    fn emit(&self, event: InstallWorkflowEvent) {
        let _ = self.sender.send(event);
    }
}

struct InstallUiApp {
    artifact_detail: Option<String>,
    displayed_progress: f32,
    event_receiver: Option<Receiver<InstallWorkflowEvent>>,
    final_result: Arc<Mutex<Option<std::result::Result<Value, String>>>>,
    finished_at: Option<Instant>,
    icon_texture: Option<TextureHandle>,
    keep_open_after_finish: bool,
    language: InstallUiLanguage,
    message: String,
    options: InstallWorkflowOptions,
    result_receiver: Option<Receiver<std::result::Result<Value, String>>>,
    started: bool,
    stage: String,
    target_progress: f32,
}

impl InstallUiApp {
    fn new(
        options: InstallWorkflowOptions,
        final_result: Arc<Mutex<Option<std::result::Result<Value, String>>>>,
        keep_open_after_finish: bool,
    ) -> Self {
        Self {
            artifact_detail: None,
            displayed_progress: 0.0,
            event_receiver: None,
            final_result,
            finished_at: None,
            icon_texture: None,
            keep_open_after_finish,
            language: detect_language(),
            message: "Preparing installer".to_string(),
            options,
            result_receiver: None,
            started: false,
            stage: "starting".to_string(),
            target_progress: 0.04,
        }
    }

    fn start_workflow(&mut self, context: &egui::Context) {
        if self.started {
            return;
        }
        self.started = true;

        let (event_sender, event_receiver) = mpsc::channel();
        let (result_sender, result_receiver) = mpsc::channel();
        let options = self.options.clone();
        let repaint_context = context.clone();
        self.event_receiver = Some(event_receiver);
        self.result_receiver = Some(result_receiver);

        thread::spawn(move || {
            let reporter = ChannelInstallProgressReporter {
                sender: event_sender,
            };
            let result =
                run_install_workflow(&options, &reporter).map_err(|error| error.to_string());
            let _ = result_sender.send(result);
            repaint_context.request_repaint();
        });
    }

    fn apply_event(&mut self, event: InstallWorkflowEvent) {
        let progress = stage_progress(&event);
        self.stage = event.stage.clone();
        self.message = event.message;
        self.target_progress = progress;
        self.artifact_detail = event.artifact_key.map(|artifact_key| {
            match (event.artifact_index, event.artifact_count) {
                (Some(index), Some(count)) => format!("{artifact_key} ({index}/{count})"),
                _ => artifact_key,
            }
        });
    }

    fn drain_workflow(&mut self) {
        if let Some(receiver) = self.event_receiver.take() {
            while let Ok(event) = receiver.try_recv() {
                self.apply_event(event);
            }
            self.event_receiver = Some(receiver);
        }

        if self.finished_at.is_some() {
            return;
        }

        if let Some(receiver) = &self.result_receiver {
            if let Ok(result) = receiver.try_recv() {
                match &result {
                    Ok(value) => {
                        let state = value
                            .get("state")
                            .and_then(Value::as_str)
                            .unwrap_or("finished");
                        self.stage = state.to_string();
                        self.message = final_state_message(state, self.language).to_string();
                        self.target_progress = 1.0;
                    }
                    Err(error) => {
                        self.stage = "error".to_string();
                        self.message = error.clone();
                    }
                }
                if let Ok(mut final_result) = self.final_result.lock() {
                    *final_result = Some(result);
                }
                self.finished_at = Some(Instant::now());
            }
        }
    }

    fn can_close(&self) -> bool {
        self.finished_at.is_some()
    }

    fn tick_progress(&mut self) {
        let delta = self.target_progress - self.displayed_progress;
        if delta.abs() < 0.002 {
            self.displayed_progress = self.target_progress;
            return;
        }
        self.displayed_progress += delta * 0.14;
    }
}

impl eframe::App for InstallUiApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        ui.ctx().set_visuals(pulse_visuals());
        self.start_workflow(ui.ctx());
        self.drain_workflow();
        self.tick_progress();

        let close_requested = ui.ctx().input(|input| input.viewport().close_requested());
        if close_requested && !self.can_close() {
            ui.ctx()
                .send_viewport_cmd(egui::ViewportCommand::CancelClose);
        }

        if self.stage == "installed" && !self.keep_open_after_finish {
            if let Some(finished_at) = self.finished_at {
                if finished_at.elapsed() >= Duration::from_millis(700) {
                    ui.ctx().send_viewport_cmd(egui::ViewportCommand::Close);
                }
            }
        }

        ui.ctx().request_repaint_after(Duration::from_millis(100));

        draw_installer(ui, self);
    }
}

fn pulse_visuals() -> egui::Visuals {
    let mut visuals = egui::Visuals::dark();
    visuals.window_fill = pulse_main();
    visuals.panel_fill = pulse_main();
    visuals.override_text_color = Some(pulse_text());
    visuals.widgets.noninteractive.bg_fill = pulse_panel();
    visuals.widgets.inactive.bg_fill = pulse_input();
    visuals.widgets.hovered.bg_fill = pulse_accent();
    visuals.widgets.active.bg_fill = pulse_accent();
    visuals
}

fn color(red: u8, green: u8, blue: u8) -> Color32 {
    Color32::from_rgb(red, green, blue)
}

fn pulse_main() -> Color32 {
    color(22, 24, 30)
}

fn pulse_panel() -> Color32 {
    color(35, 38, 49)
}

fn pulse_border() -> Color32 {
    color(61, 68, 91)
}

fn pulse_text() -> Color32 {
    color(228, 229, 234)
}

fn pulse_muted_text() -> Color32 {
    color(163, 171, 198)
}

fn pulse_input() -> Color32 {
    color(59, 65, 85)
}

fn pulse_accent() -> Color32 {
    color(62, 106, 255)
}

fn pulse_close_hover() -> Color32 {
    color(62, 68, 86)
}

#[derive(Clone, Copy)]
enum InstallUiLanguage {
    En,
    Ru,
}

fn detect_language() -> InstallUiLanguage {
    let locale = ["PULSESYNC_LANG", "LC_ALL", "LC_MESSAGES", "LANG"]
        .into_iter()
        .find_map(|name| env::var(name).ok())
        .unwrap_or_default()
        .to_lowercase();

    if locale.starts_with("en") {
        InstallUiLanguage::En
    } else {
        InstallUiLanguage::Ru
    }
}

fn draw_installer(ui: &mut egui::Ui, app: &mut InstallUiApp) {
    let rect = ui.max_rect();
    let close_rect =
        Rect::from_min_size(rect.right_top() + Vec2::new(-42.0, 12.0), Vec2::splat(26.0));
    let drag_rect = Rect::from_min_max(
        rect.left_top(),
        egui::pos2(close_rect.left() - 8.0, rect.top() + 48.0),
    );
    let drag_response = ui.interact(
        drag_rect,
        ui.id().with("installer_drag"),
        Sense::click_and_drag(),
    );
    if drag_response.drag_started() {
        ui.ctx().send_viewport_cmd(egui::ViewportCommand::StartDrag);
    }

    ui.painter().rect_filled(rect, 8.0, pulse_panel());
    ui.painter().rect_stroke(
        rect.shrink(0.5),
        8.0,
        Stroke::new(1.0, pulse_border()),
        StrokeKind::Inside,
    );

    if draw_close_button(ui, close_rect) {
        ui.ctx().send_viewport_cmd(egui::ViewportCommand::Close);
    }

    ui.scope_builder(UiBuilder::new().max_rect(rect.shrink(36.0)), |ui| {
        ui.vertical_centered(|ui| {
            ui.add_space(68.0);
            let texture = app
                .icon_texture
                .get_or_insert_with(|| load_app_icon_texture(ui.ctx()));
            ui.add(egui::Image::new((texture.id(), Vec2::splat(68.0))));
            ui.add_space(28.0);
            static_label(
                ui,
                RichText::new(stage_title(&app.stage, app.language))
                    .size(16.0)
                    .strong()
                    .color(pulse_text()),
            );
            ui.add_space(16.0);
            draw_minimal_progress(ui, app.displayed_progress);
            if let Some(detail) = &app.artifact_detail {
                ui.add_space(12.0);
                static_label(
                    ui,
                    RichText::new(detail).size(11.0).color(pulse_muted_text()),
                );
            }
        });
    });
}

fn draw_close_button(ui: &mut egui::Ui, rect: Rect) -> bool {
    let response = ui
        .interact(rect, ui.id().with("installer_close"), Sense::click())
        .on_hover_cursor(egui::CursorIcon::PointingHand);
    let fill = if response.hovered() {
        pulse_close_hover()
    } else {
        Color32::TRANSPARENT
    };
    let icon_color = if response.hovered() {
        pulse_text()
    } else {
        pulse_muted_text()
    };
    let stroke = Stroke::new(1.5, icon_color);
    let center = rect.center();
    let offset = 4.2;

    ui.painter().rect_filled(rect, 6.0, fill);
    ui.painter().line_segment(
        [
            center + Vec2::new(-offset, -offset),
            center + Vec2::new(offset, offset),
        ],
        stroke,
    );
    ui.painter().line_segment(
        [
            center + Vec2::new(offset, -offset),
            center + Vec2::new(-offset, offset),
        ],
        stroke,
    );

    response.clicked()
}

fn static_label(ui: &mut egui::Ui, text: RichText) {
    ui.add(Label::new(text).selectable(false));
}

fn load_app_icon_texture(context: &egui::Context) -> TextureHandle {
    let image = image::load_from_memory(APP_ICON)
        .expect("embedded PulseSync app icon must be a valid image")
        .to_rgba8();
    let size = [image.width() as usize, image.height() as usize];
    let color_image = ColorImage::from_rgba_unmultiplied(size, image.as_raw());
    context.load_texture("pulsesync-app-icon", color_image, TextureOptions::LINEAR)
}

fn load_app_icon_data() -> egui::IconData {
    let image = image::load_from_memory(APP_ICON)
        .expect("embedded PulseSync app icon must be a valid image")
        .to_rgba8();
    egui::IconData {
        width: image.width(),
        height: image.height(),
        rgba: image.into_raw(),
    }
}

fn install_pulse_fonts(context: &egui::Context) {
    const NUNITO: &[u8] =
        include_bytes!("../../../../src/renderer/shared/assets/fonts/nunito/Nunito.ttf");
    if !is_ttf_or_otf(NUNITO) {
        return;
    }

    let mut fonts = FontDefinitions::default();
    fonts.font_data.insert(
        "nunito".to_string(),
        std::sync::Arc::new(FontData::from_static(NUNITO)),
    );

    for family in [FontFamily::Proportional, FontFamily::Monospace] {
        let entries = fonts.families.entry(family).or_default();
        entries.insert(0, "nunito".to_string());
    }

    context.set_fonts(fonts);
}

fn is_ttf_or_otf(bytes: &[u8]) -> bool {
    matches!(
        bytes.get(0..4),
        Some([0x00, 0x01, 0x00, 0x00]) | Some(b"OTTO") | Some(b"true") | Some(b"ttcf")
    )
}

fn draw_minimal_progress(ui: &mut egui::Ui, progress: f32) {
    let progress = progress.clamp(0.0, 1.0);
    let width = 164.0;
    let (rect, _) = ui.allocate_exact_size(Vec2::new(width, 5.0), Sense::hover());
    let fill_width = rect.width() * progress;
    let fill_rect = Rect::from_min_size(rect.min, Vec2::new(fill_width, rect.height()));
    ui.painter().rect_filled(rect, 2.5, pulse_input());
    ui.painter().rect_filled(fill_rect, 2.5, pulse_accent());
}

fn stage_progress(event: &InstallWorkflowEvent) -> f32 {
    if event.stage == "downloading" {
        if let (Some(index), Some(count)) = (event.artifact_index, event.artifact_count) {
            if count > 0 {
                return 0.18 + (index as f32 / count as f32) * 0.34;
            }
        }
    }

    match event.stage.as_str() {
        "checking" => 0.08,
        "downloading" => 0.18,
        "planning" => 0.58,
        "preparing" => 0.72,
        "applying" => 0.88,
        "installed" => 1.0,
        "blocked" => 1.0,
        _ => 0.04,
    }
}

fn stage_title(stage: &str, language: InstallUiLanguage) -> &'static str {
    match language {
        InstallUiLanguage::En => match stage {
            "checking" => "Checking for updates...",
            "downloading" => "Downloading update...",
            "planning" | "preparing" => "Preparing update...",
            "applying" => "Installing update...",
            "installed" => "Launching PulseSync...",
            "blocked" => "Update is blocked",
            "error" => "Update failed",
            _ => "Starting...",
        },
        InstallUiLanguage::Ru => match stage {
            "checking" => "Проверяем обновления...",
            "downloading" => "Загружаем обновление...",
            "planning" | "preparing" => "Подготавливаем обновление...",
            "applying" => "Устанавливаем обновление...",
            "installed" => "Запускаем PulseSync...",
            "blocked" => "Обновление заблокировано",
            "error" => "Ошибка обновления",
            _ => "Запускаем...",
        },
    }
}

fn final_state_message(state: &str, language: InstallUiLanguage) -> &'static str {
    match language {
        InstallUiLanguage::En => match state {
            "installed" => "Launching PulseSync...",
            "blocked" => "PulseSync could not be installed automatically",
            _ => "Installer finished",
        },
        InstallUiLanguage::Ru => match state {
            "installed" => "Запускаем PulseSync...",
            "blocked" => "Не удалось автоматически установить PulseSync",
            _ => "Установка завершена",
        },
    }
}

pub fn run_install_ui(
    options: &InstallWorkflowOptions,
) -> std::result::Result<Value, InstallUiError> {
    run_install_ui_with_options(options, false)
}

pub fn run_install_ui_with_options(
    options: &InstallWorkflowOptions,
    keep_open_after_finish: bool,
) -> std::result::Result<Value, InstallUiError> {
    let final_result = Arc::new(Mutex::new(None));
    let app_options = options.clone();
    let app_result = Arc::clone(&final_result);
    let native_options = eframe::NativeOptions {
        centered: true,
        persist_window: false,
        viewport: egui::ViewportBuilder::default()
            .with_app_id("pulsesync")
            .with_decorations(false)
            .with_icon(load_app_icon_data())
            .with_inner_size([286.0, 344.0])
            .with_min_inner_size([286.0, 344.0])
            .with_resizable(false),
        ..Default::default()
    };

    eframe::run_native(
        "PulseSync Installer",
        native_options,
        Box::new(move |context| {
            install_pulse_fonts(&context.egui_ctx);
            Ok(Box::new(InstallUiApp::new(
                app_options.clone(),
                Arc::clone(&app_result),
                keep_open_after_finish,
            )))
        }),
    )
    .map_err(|error| InstallUiError::Startup(error.to_string()))?;

    let mut final_result = final_result
        .lock()
        .map_err(|_| InstallUiError::Workflow("install UI result lock is poisoned".to_string()))?;
    match final_result.take() {
        Some(Ok(value)) => Ok(value),
        Some(Err(error)) => Err(InstallUiError::Workflow(error)),
        None => Err(InstallUiError::Closed),
    }
}

pub fn install_ui(args: &Args) -> Result<Value> {
    let options = install_workflow_options_from_args(args)?;
    run_install_ui_with_options(&options, args.keep_install_ui_open).map_err(Into::into)
}
