YouTube API:
Summary: YouTube Data API v3 integration for existing channels. Video upload, metadata optimization, thumbnails, playlists, comments, and analytics. Agent uses web_fetch for all API calls with OAuth Bearer token. Prerequisite: an existing YouTube channel.

Setup:

1. Enable YouTube API in your Google Cloud project:
   · console.cloud.google.com → APIs & Services → Library
   · Search "YouTube Data API v3" → Enable
   · Search "YouTube Analytics API" → Enable
   · If no project exists: New Project → name "GenosOS" → Create, then enable both APIs
2. Add YouTube scope to OAuth:
   · If google-antigravity provider already configured: run genosos models auth login --provider google-antigravity
   · Grant youtube scope when prompted
   · If no provider yet: APIs & Services → Credentials → Create OAuth client ID → Desktop app → copy Client ID + Secret → configure provider
3. Configure:
   config_manage set services.youtube.enabled true
   · Channel ID auto-detected via GET /channels?part=id&mine=true
   · Or manually: youtube.com → your channel → About → channel URL contains UC... ID
   config_manage set services.youtube.channelId "UC..."
   config_manage set services.youtube.defaultLanguage "es"
   config_manage set services.youtube.defaultCategoryId "22"
   · Categories: 1=Film, 10=Music, 15=Pets, 17=Sports, 20=Gaming, 22=People/Blogs, 24=Entertainment, 25=News, 26=Howto/Style, 27=Education, 28=Science/Tech
4. Verify:
   web_fetch GET "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true" headers={"Authorization":"Bearer {token}"}
   Success: 200 with channel name, subscribers, video count. Failure: 401 = token expired, 403 = API not enabled or scope missing.

API Reference (agent uses web_fetch):

Base URL: https://www.googleapis.com/youtube/v3
All requests: Authorization: Bearer {access_token}, Content-Type: application/json

Channel Info:
GET /channels?part=snippet,statistics,contentDetails&mine=true

List Videos:
GET /search?part=snippet&forMine=true&type=video&maxResults=10&order=date
· order=viewCount for most viewed, order=date for most recent

Get Video Details:
GET /videos?part=snippet,statistics,contentDetails,status&id={videoId}
· Multiple: id=vid1,vid2,vid3 (max 50)

Upload Video (resumable, 2 steps):
Step 1 — Initiate:
POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
Headers: Content-Type: application/json, X-Upload-Content-Type: video/\*
Body: {
"snippet": {
"title": "Video Title",
"description": "Description with #hashtags",
"tags": ["tag1", "tag2"],
"categoryId": "28",
"defaultLanguage": "es"
},
"status": {
"privacyStatus": "private",
"selfDeclaredMadeForKids": false,
"publishAt": "2026-03-10T15:00:00Z"
}
}
Returns: Location header = upload URL.
· ALWAYS upload as "private" first. Verify before making public.
· publishAt requires privacyStatus="private".

Step 2 — Send file:
PUT {upload-url}
Headers: Content-Type: video/mp4
Body: raw video bytes

Update Metadata:
PUT /videos?part=snippet,status
Body: {"id":"{videoId}","snippet":{"title":"New Title","description":"...","tags":["a","b"],"categoryId":"28"},"status":{"privacyStatus":"public"}}
· PUT replaces entire snippet — include all fields

Set Thumbnail:
POST https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId={videoId}
Headers: Content-Type: image/png
Body: raw image bytes
· 1280x720px, <2MB, JPG or PNG. Channel must be verified for custom thumbnails.

Playlists:
· List: GET /playlists?part=snippet,contentDetails&mine=true&maxResults=25
· Create: POST /playlists?part=snippet,status Body: {"snippet":{"title":"Playlist","description":"..."},"status":{"privacyStatus":"public"}}
· Add video: POST /playlistItems?part=snippet Body: {"snippet":{"playlistId":"{id}","resourceId":{"kind":"youtube#video","videoId":"{id}"}}}
· Remove: DELETE /playlistItems?id={playlistItemId}

Comments:
· List: GET /commentThreads?part=snippet&videoId={videoId}&maxResults=20&order=relevance
· Reply: POST /comments?part=snippet Body: {"snippet":{"parentId":"{commentId}","textOriginal":"Reply text"}}

Analytics (YouTube Analytics API):
Base URL: https://youtubeanalytics.googleapis.com/v2

Video performance:
GET /reports?ids=channel==MINE&startDate={YYYY-MM-DD}&endDate={YYYY-MM-DD}&metrics=views,estimatedMinutesWatched,averageViewDuration,likes,subscribersGained&dimensions=video&sort=-views&maxResults=10

Channel daily:
GET /reports?ids=channel==MINE&startDate={YYYY-MM-DD}&endDate={YYYY-MM-DD}&metrics=views,estimatedMinutesWatched,subscribersGained,subscribersLost&dimensions=day

Traffic sources:
GET /reports?ids=channel==MINE&startDate={YYYY-MM-DD}&endDate={YYYY-MM-DD}&metrics=views&dimensions=insightTrafficSourceType&sort=-views

Quotas:
Daily limit: 10,000 units. Read=1, Write=50, Upload=1600, Search=100.
Resets at midnight Pacific. Agent should batch reads and cache video IDs.

Diagnostic:
STOP. Do NOT guess. Follow in order:

1. 401 → token expired. Run: genosos models auth login --provider google-antigravity
2. 403 → API not enabled in Cloud Console, or quota exceeded, or YouTube scope missing
3. 403 on thumbnail → channel not verified. youtube.com/verify
4. 404 → videoId/playlistId invalid. Private videos from other accounts return 404.
5. Upload fails → check file <256GB, MP4 format, upload URL not expired (~24h)
6. Scheduled publish fails → publishAt needs privacyStatus="private" + future ISO 8601 date
7. Analytics empty → data takes 24-48h. Check yt-analytics.readonly scope.
8. Quota exceeded → resets midnight PT. Reduce search calls.

Config Paths:
services.youtube.enabled: boolean, false — Enable YouTube integration
services.youtube.channelId: string — Channel ID (UC...)
services.youtube.defaultLanguage: string, en — Default video language
services.youtube.defaultCategoryId: string, 22 — Default category
services.youtube.defaultPrivacy: string, private — Upload privacy (private|unlisted|public)
services.youtube.publishTimezone: string, Europe/Madrid — Scheduled publish timezone
