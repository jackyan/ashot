use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum CaptureErrorKind {
    Permission,
    Cancelled,
    CaptureFailed,
    StitchFailed,
    CommandFailed,
    ValidationFailed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CaptureError {
    pub kind: CaptureErrorKind,
    pub message: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct CaptureRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub trait ScreenCaptureProvider: Send + Sync {
    fn capture_region(&self, rect: CaptureRect) -> Result<Vec<u8>, CaptureError>;
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ScrollSessionState {
    Ready,
    Capturing,
    Paused,
    Done,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum SkipReason {
    Duplicate,
    TooSmallDelta,
    MatchFailed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum StopReason {
    User,
    Timeout,
    ReachedMaxHeight,
    NoNewContent,
    ConsecutiveFailures,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum AppendResult {
    Accepted { dy: u32, score: f64 },
    Skipped(SkipReason),
    AutoStopped(StopReason),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScrollConfig {
    pub max_height_px: u32,
    pub max_frames: usize,
    pub throttle_ms: u64,
    pub max_consecutive_failures: u8,
}

impl Default for ScrollConfig {
    fn default() -> Self {
        Self {
            max_height_px: 20_000,
            max_frames: 300,
            throttle_ms: 100,
            max_consecutive_failures: 3,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScrollProgress {
    pub frames: usize,
    pub captured_height_px: u32,
    pub state: ScrollSessionState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScrollSession {
    state: ScrollSessionState,
    config: ScrollConfig,
    frames: usize,
    captured_height_px: u32,
    consecutive_failures: u8,
}

impl ScrollSession {
    pub fn new(config: ScrollConfig) -> Self {
        Self {
            state: ScrollSessionState::Ready,
            config,
            frames: 0,
            captured_height_px: 0,
            consecutive_failures: 0,
        }
    }

    pub fn mark_capturing(&mut self) {
        if self.state == ScrollSessionState::Ready || self.state == ScrollSessionState::Paused {
            self.state = ScrollSessionState::Capturing;
        }
    }

    pub fn append_accepted(&mut self, added_height: u32, score: f64) -> AppendResult {
        self.frames += 1;
        self.captured_height_px = self.captured_height_px.saturating_add(added_height);
        self.consecutive_failures = 0;

        if self.captured_height_px >= self.config.max_height_px {
            self.state = ScrollSessionState::Done;
            return AppendResult::AutoStopped(StopReason::ReachedMaxHeight);
        }

        if self.frames >= self.config.max_frames {
            self.state = ScrollSessionState::Done;
            return AppendResult::AutoStopped(StopReason::ReachedMaxHeight);
        }

        self.state = ScrollSessionState::Capturing;
        AppendResult::Accepted {
            dy: added_height,
            score,
        }
    }

    pub fn append_failed(&mut self) -> AppendResult {
        self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        if self.consecutive_failures >= self.config.max_consecutive_failures {
            self.state = ScrollSessionState::Error;
            return AppendResult::AutoStopped(StopReason::ConsecutiveFailures);
        }
        AppendResult::Skipped(SkipReason::MatchFailed)
    }

    pub fn cancel(&mut self) {
        self.state = ScrollSessionState::Done;
    }

    pub fn progress(&self) -> ScrollProgress {
        ScrollProgress {
            frames: self.frames,
            captured_height_px: self.captured_height_px,
            state: self.state,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_defaults_are_expected() {
        let session = ScrollSession::new(ScrollConfig::default());
        assert_eq!(session.progress().frames, 0);
        assert_eq!(session.progress().captured_height_px, 0);
        assert_eq!(session.progress().state, ScrollSessionState::Ready);
    }

    #[test]
    fn accepted_frame_updates_progress() {
        let mut session = ScrollSession::new(ScrollConfig::default());
        session.mark_capturing();
        let result = session.append_accepted(320, 0.93);
        assert!(matches!(result, AppendResult::Accepted { dy: 320, score: _ }));
        assert_eq!(session.progress().frames, 1);
        assert_eq!(session.progress().captured_height_px, 320);
        assert_eq!(session.progress().state, ScrollSessionState::Capturing);
    }

    #[test]
    fn consecutive_failures_auto_stop_session() {
        let mut session = ScrollSession::new(ScrollConfig {
            max_consecutive_failures: 2,
            ..ScrollConfig::default()
        });
        assert!(matches!(session.append_failed(), AppendResult::Skipped(SkipReason::MatchFailed)));
        assert!(matches!(
            session.append_failed(),
            AppendResult::AutoStopped(StopReason::ConsecutiveFailures)
        ));
        assert_eq!(session.progress().state, ScrollSessionState::Error);
    }
}
