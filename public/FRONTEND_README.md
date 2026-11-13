# CyberDrill: 60-Second Incident Trainer

Frontend for the hackathon project. A retro CRT arcade terminal where the user has 60 seconds to pick a response to a cyber incident.

## Run it
Double-click `index.html` (needs internet once for the Google Fonts), or use VS Code "Live Server".

## Files
- `index.html`: page shell
- `css/style.css`: CRT / arcade theme (palette variables at the top of the file)
- `js/app.js`: incidents (`S` array), modes (`MODES`), screens, timer, scoring, sound

## Integration points for the backend
- `S` in `js/app.js` holds the incidents. Replace it with a `fetch()` to your API.
- `finish(i)` calculates the score. Send `{incident, choice, timeLeft}` to the backend here.
- `results()` shows the feedback text (`o[2]`). Replace it with the AI explanation from the API.

## Palette
Forest Green #022E21, Dark Purple #3C183C, Fresh Lime #CDFC8A, Soft Lavender #D2CBFE
