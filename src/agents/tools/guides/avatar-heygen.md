Avatar HeyGen:
Summary: HeyGen API integration for AI avatar video generation. Agent creates videos with digital presenters from script + voice, polls for completion, and retrieves the rendered video URL. All API calls via web_fetch with x-api-key header. Best for: content creators, AI YouTubers, training videos, marketing. Prerequisite: HeyGen account with API plan.

Setup:

1. Create HeyGen account: heygen.com → sign up → verify email
2. Get API key:
   · Login → Space Settings (bottom-left gear) → API tab → copy API key
   · Free plan: 10 credits/month (enough for testing)
   · Paid: Pro $99/month (100 credits), Scale $330/month (660 credits)
3. Store API key in GenosOS:
   config_manage set services.heygen.apiKey "your-api-key-here"
   Securely stored in vault (NYXENC1 encrypted).
4. Verify connection:
   web_fetch GET "https://api.heygen.com/v2/avatars" headers={"x-api-key":"{apiKey}"}
   Success: 200 with avatars list. Failure: 401 = invalid key.
5. Browse available avatars and voices:
   · Avatars: GET https://api.heygen.com/v2/avatars → pick avatar_id
   · Voices: GET https://api.heygen.com/v2/voices → pick voice_id
   · Or use avatar + voice from HeyGen Studio (heygen.com/app) to preview before generating via API

API Reference (agent uses web_fetch):

Base URL: https://api.heygen.com
All requests: x-api-key: {apiKey}, Content-Type: application/json

List Avatars:
GET /v2/avatars
Returns: avatars[] (avatar_id, avatar_name, gender, preview_image_url, premium, tags) + talking_photos[] (talking_photo_id, talking_photo_name, preview_image_url).
· Tags include "AVATAR_IV" for latest generation avatars.
· talking_photos = static image avatars (cheaper, simpler).

List Voices:
GET /v2/voices
Returns: voices[] (voice_id, name, language, gender, preview_audio).
· Filter by language for content in specific languages.

Create Video (avatar + text-to-speech):
POST /v2/video/generate
Body: {
"title": "Video Title",
"caption": true,
"video_inputs": [{
"character": {
"type": "avatar",
"avatar_id": "Abigail_standing_office_front",
"scale": 1,
"avatar_style": "normal"
},
"voice": {
"type": "text",
"voice_id": "1bd001e7e50f421d891986aad5158bc8",
"input_text": "Hello! Welcome to this video.",
"speed": 1.0,
"pitch": 0,
"emotion": "Friendly"
},
"background": {
"type": "color",
"value": "#FFFFFF"
}
}],
"dimension": {"width": 1920, "height": 1080},
"callback_url": "https://{gateway-public-url}/hooks/heygen"
}
Returns: {"error": null, "data": {"video_id": "abc123"}}

Create Video (avatar + pre-recorded audio):
POST /v2/video/generate
Body: {
"title": "Video with Custom Voice",
"video_inputs": [{
"character": {
"type": "avatar",
"avatar_id": "Abigail_standing_office_front",
"avatar_style": "normal"
},
"voice": {
"type": "audio",
"audio_url": "https://example.com/narration.mp3"
},
"background": {
"type": "image",
"url": "https://example.com/background.jpg"
}
}],
"dimension": {"width": 1920, "height": 1080}
}
· Use audio_url for remote files or audio_asset_id for uploaded assets.
· This is the recommended flow for content creators: generate narration with Kokoro/ElevenLabs TTS first, then pass audio to HeyGen.

Check Video Status:
GET /v1/video_status.get?video_id={videoId}
Returns: {
"code": 100,
"data": {
"id": "video-id",
"status": "completed",
"duration": 45.5,
"video_url": "https://files2.heygen.ai/...",
"video_url_caption": "https://files2.heygen.ai/...",
"thumbnail_url": "https://files2.heygen.ai/...",
"gif_url": "https://resource2.heygen.ai/...",
"error": null
}
}
Statuses: pending → processing → completed (or failed).
· video_url expires in 7 days — download promptly.
· If callback_url is set, HeyGen sends POST when done (no polling needed).

Upload Asset:
POST /v1/asset
Headers: Content-Type: multipart/form-data
Body: file (binary), content_type ("audio" | "image" | "video")
Returns: asset_id for use in video generation.
· Max: audio 50MB, image 50MB, video 100MB.

Character Options:
· type: "avatar" (full digital person) or "talking_photo" (animated photo)
· avatar_style: "normal" (full body), "circle" (circular crop), "closeUp" (face only)
· talking_style: "stable" (minimal movement) or "expressive" (natural gestures)
· expression: "default" or "happy"
· scale: 0.0 to 5.0 (avatar size in frame)
· offset: {x, y} to position avatar in frame

Voice Options:
· type "text": TTS with voice_id, input_text, speed (0.5-1.5), pitch (-50 to 50), emotion (Excited/Friendly/Serious/Soothing/Broadcaster)
· type "audio": pre-recorded audio via audio_url or audio_asset_id
· type "silence": pause with duration (1.0-100.0 seconds)
· ElevenLabs integration: elevenlabs_settings object for fine control (model, similarity_boost, stability, style)
· Max text: 5000 chars per scene. Max audio: 10 min (600s).

Background Options:
· "color": hex value (e.g., "#000000")
· "image": url or image_asset_id, fit options (crop/cover/contain/none)
· "video": url or video_asset_id, play_style (freeze/loop/fit_to_scene)

Multi-Scene Videos:
video_inputs is an array — add multiple objects for multi-scene videos (max 50 scenes).
Each scene can have different avatar, voice, and background.

Credits:
· Standard avatar: ~1 credit per minute of video
· Avatar IV: ~6 credits per minute (1 credit per 10 seconds)
· Free plan: 10 credits/month, max 720p
· Pro: 100 credits/month, up to 4K
· Scale: 660 credits/month

Common Patterns:

Content creator flow (recommended):

1. Agent writes script (LLM)
2. Agent generates narration audio (Kokoro TTS or ElevenLabs)
3. Agent creates video: POST /v2/video/generate with avatar + audio_url + background
4. Agent polls status or waits for callback
5. Agent downloads video_url → uploads to YouTube via YouTube Data API
6. Agent notifies creator via WhatsApp

Quick text-to-speech flow:

1. Agent creates video with voice type "text" + input_text (HeyGen handles TTS)
2. Simpler but less control over voice quality

Batch production:
Agent generates multiple scenes as separate videos → downloads → concatenates with ffmpeg → uploads final video.

Diagnostic:
STOP. Do NOT guess. Follow in order:

1. 401 → API key invalid. Check key in Space Settings → API tab. Regenerate if needed.
2. 400 invalid_parameter → check request body. Common: missing audio_url/audio_asset_id, invalid hex color, avatar_id doesn't exist.
3. Video status "failed" → check error field in status response. Common: audio too long (>10 min), unsupported format, insufficient credits.
4. Video URL expired → URLs expire after 7 days. Re-check status to get fresh URL (if still available).
5. Low quality → check dimension (default 1920x1080). Free plan caps at 720p. Use avatar_style "normal" for full body.
6. Credits exhausted → check usage at Space Settings → History → API Usage. Credits reset monthly.
7. Slow rendering → Avatar IV takes longer (~2-5 min per minute of video). Standard avatars render faster.

HeyGen Config Paths:
services.heygen.apiKey: string — HeyGen API key (secret)
services.heygen.defaultAvatarId: string — Preferred avatar ID for quick generation
services.heygen.defaultVoiceId: string — Preferred voice ID
services.heygen.defaultDimension: object, {width:1920,height:1080} — Output resolution
services.heygen.callbackUrl: string — Webhook URL for completion notifications
