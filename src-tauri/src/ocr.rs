//! OCR module using macOS Vision framework

use crate::utils::AppResult;

#[cfg(target_os = "macos")]
pub fn recognize_text_from_image(image_path: &str) -> AppResult<String> {
    use objc2::rc::autoreleasepool;
    use objc2::runtime::AnyObject;
    use objc2::AnyThread;
    use objc2_foundation::{NSArray, NSDictionary, NSString, NSURL};
    use objc2_vision::{
        VNImageRequestHandler, VNRecognizeTextRequest, VNRecognizeTextRequestRevision3,
        VNRecognizedText, VNRecognizedTextObservation, VNRequest,
        VNRequestTextRecognitionLevel,
    };
    use std::path::Path;

    let path = Path::new(image_path);
    if !path.exists() {
        return Err(format!("Image file does not exist: {}", image_path));
    }

    autoreleasepool(|_| unsafe {
        let ns_string = NSString::from_str(image_path);
        let ns_url = NSURL::fileURLWithPath_isDirectory(&ns_string, false);
        let options = NSDictionary::<NSString, AnyObject>::new();

        let handler = VNImageRequestHandler::initWithURL_options(
            VNImageRequestHandler::alloc(),
            &ns_url,
            &*options,
        );

        let text_request = VNRecognizeTextRequest::init(VNRecognizeTextRequest::alloc());

        text_request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
        text_request.setUsesLanguageCorrection(true);

        // Use revision 3 (macOS 14+) for best CJK accuracy
        let request_ref: &VNRequest = text_request.as_ref();
        request_ref.setRevision(VNRecognizeTextRequestRevision3);

        // Set recognition languages for multi-language support
        let langs = NSArray::from_slice(&[
            &*NSString::from_str("zh-Hans"),
            &*NSString::from_str("zh-Hant"),
            &*NSString::from_str("en-US"),
            &*NSString::from_str("ja"),
            &*NSString::from_str("ko"),
        ]);
        text_request.setRecognitionLanguages(&langs);

        // Enable automatic language detection
        text_request.setAutomaticallyDetectsLanguage(true);

        // Lower minimum text height to detect smaller text in screenshots
        text_request.setMinimumTextHeight(0.01);

        let requests = NSArray::from_slice(&[request_ref]);

        handler
            .performRequests_error(&requests)
            .map_err(|e| format!("Vision request failed: {:?}", e))?;

        let observations = text_request.results();
        let mut recognized_texts = Vec::new();

        if let Some(obs_array) = observations {
            for obs in obs_array.iter() {
                if let Some(text_obs) = obs.downcast_ref::<VNRecognizedTextObservation>() {
                    // Skip low-confidence observations
                    if text_obs.confidence() < 0.15 {
                        continue;
                    }

                    let candidates = text_obs.topCandidates(1);
                    for cand in candidates.iter() {
                        if let Some(text_cand) = cand.downcast_ref::<VNRecognizedText>() {
                            let str_ref = text_cand.string();
                            let text = str_ref.to_string();
                            if !text.trim().is_empty() {
                                recognized_texts.push(text);
                            }
                        }
                    }
                }
            }
        }

        if recognized_texts.is_empty() {
            return Err("No text recognized in image".to_string());
        }

        Ok(recognized_texts.join("\n"))
    })
}

#[cfg(not(target_os = "macos"))]
pub fn recognize_text_from_image(_image_path: &str) -> AppResult<String> {
    Err("OCR is only supported on macOS".to_string())
}
