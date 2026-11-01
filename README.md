# Ayni social media portfolio

Plain HTML, CSS and vanilla JavaScript. No build step, no npm.

- `index.html`: homepage 3D carousel (drag, scroll, arrow keys; snaps to one featured project)
- `project.html`: case-study page, one per project, opened as `project.html?id=<file name without extension>`
- `research.html`: five-step research and strategy page
- `content/designs.json`: one entry per design
- `content/steps.json`: the research text for each step, plus the closing section
- `assets/designs/`: images and videos; `assets/designs/posters/`: video poster frames

## Add a design

1. Put the file in `assets/designs/` (images under about 300 KB, videos under about 10 MB).
2. For a video, also add a poster frame at `assets/designs/posters/<same-name>.jpg`.
3. Add one entry to `content/designs.json`:

```json
{ "file": "my-post.jpg", "type": "image", "title": "My post", "alt": "What the image shows", "caption": "One line", "step": 3 }
```

`type` is `"image"` or `"video"`. `step` is 1 to 5 and decides which research step it appears next to. Order in the file is the order in the gallery.

Every design automatically gets its own case-study page. Optional fields in its entry fill the page
(any you leave out show "To be added." in grey; `results` is hidden unless supplied):

```json
"intro": "...", "objective": "...", "audience": "...", "strategy": "...",
"role": "...", "execution": "...", "results": "...",
"gallery": [ { "file": "extra-1.jpg", "alt": "What it shows" } ]
```

`audience` and `strategy` fall back to the research step's insight and paragraph. `id` can be set to
choose the page's URL name. Extra `gallery` files go in `assets/designs/` too.

Moving a design to another step is just changing its `step` number.

## Edit the research text

Edit `content/steps.json`. Each step has `title`, `summary`, `paragraph`, `facts` (label and value pairs, shown as a 2 by 2 grid), `insight` and `fullText` (blank line = new paragraph). The `closing` object holds the "What I'd confirm in week one" checklist and the contact email.

## Preview locally

`fetch()` of the JSON files needs a server, so do not open the HTML by double-clicking.

```
python3 serve.py
```

Then open http://localhost:8000. `serve.py` is the same as `python3 -m http.server` but also supports
Range requests; Safari cannot play videos from the plain version. (The plain command still works for
Chrome and for checking the layout.) GitHub Pages does not need `serve.py`.

## Publish on GitHub Pages

1. Push this folder to a GitHub repository (`index.html` must be at the repo root).
2. Settings, Pages, Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
3. `.nojekyll` is already included.

After publishing, change the `og:image` in both HTML files to the full URL of an image
(for example `https://<user>.github.io/<repo>/assets/designs/ayni-woman.jpg`) so link previews work.

## Video posters without ffmpeg

ffmpeg was not installed when this was built, so posters were taken with macOS Quick Look. To install
ffmpeg: `brew install ffmpeg`. A poster frame can then be made with
`ffmpeg -i in.mp4 -frames:v 1 -q:v 3 assets/designs/posters/in.jpg`, and a `.mov` converted with
`ffmpeg -i in.mov -vf scale=720:-2 -c:v libx264 -crf 26 -an -movflags +faststart out.mp4`.
