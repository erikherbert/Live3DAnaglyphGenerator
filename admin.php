<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Live 3D Anaglyph Generator - Admin</title>
  <link rel="stylesheet" href="assets/style.css">
  <script src="assets/admin.js" defer></script>
</head>
<body>
  <main class="app">
    <header class="topbar">
      <div>
        <p class="eyebrow">WebRTC P2P</p>
        <h1>Live 3D Anaglyph Generator</h1>
        <p class="intro">Generate a live red/cyan 3D preview from two browser cameras. PHP stores connection data only, never images.</p>
      </div>
      <div class="server-status is-warn" id="serverStatus">Connecting ...</div>
    </header>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Camera Links</h2>
          <p>Open these room links on two camera devices. Safari requires HTTPS and a tap on `Start Camera`.</p>
        </div>
        <button class="btn" id="reconnectButton" type="button">Reconnect</button>
      </div>
      <div class="camera-links">
        <div class="camera-link-item">
          <a id="cameraALink" href="camera.php?side=a" target="_blank" rel="noreferrer">Camera A</a>
          <button class="btn btn-icon share-link" id="shareCameraA" type="button" aria-label="Share Camera A link" title="Share Camera A link">
            <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
              <path d="M18 16.1c-.76 0-1.44.3-1.96.77L8.91 12.7a3.3 3.3 0 0 0 0-1.4l7.05-4.13A3 3 0 1 0 15 5c0 .24.03.47.08.69L8.03 9.82a3 3 0 1 0 0 4.36l7.12 4.18c-.1.27-.15.56-.15.86a3 3 0 1 0 3-3.12Z"/>
            </svg>
          </button>
        </div>
        <div class="camera-link-item">
          <a id="cameraBLink" href="camera.php?side=b" target="_blank" rel="noreferrer">Camera B</a>
          <button class="btn btn-icon share-link" id="shareCameraB" type="button" aria-label="Share Camera B link" title="Share Camera B link">
            <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
              <path d="M18 16.1c-.76 0-1.44.3-1.96.77L8.91 12.7a3.3 3.3 0 0 0 0-1.4l7.05-4.13A3 3 0 1 0 15 5c0 .24.03.47.08.69L8.03 9.82a3 3 0 1 0 0 4.36l7.12 4.18c-.1.27-.15.56-.15.86a3 3 0 1 0 3-3.12Z"/>
            </svg>
          </button>
        </div>
      </div>
    </section>

    <section class="preview-grid" aria-label="Live preview">
      <article class="panel preview-card">
        <div class="panel-head compact">
          <div>
            <h2>Camera A / Left</h2>
            <p id="statusA">Not connected</p>
          </div>
          <span class="pill is-error" id="mediaA">-</span>
        </div>
        <div class="preview-stage" id="stageA">
          <video id="videoA" playsinline autoplay muted></video>
          <p class="placeholder">Waiting for WebRTC stream.</p>
        </div>
        <p class="meta" id="metaA">Stream: -</p>
      </article>

      <article class="panel preview-card">
        <div class="panel-head compact">
          <div>
            <h2>Camera B / Right</h2>
            <p id="statusB">Not connected</p>
          </div>
          <span class="pill is-error" id="mediaB">-</span>
        </div>
        <div class="preview-stage" id="stageB">
          <video id="videoB" playsinline autoplay muted></video>
          <p class="placeholder">Waiting for WebRTC stream.</p>
        </div>
        <p class="meta" id="metaB">Stream: -</p>
      </article>
    </section>

    <section class="panel anaglyph-panel">
      <div class="panel-head">
        <div>
          <h2>Live Red/Cyan 3D Preview</h2>
          <p id="anaglyphMeta">Waiting for both camera streams.</p>
        </div>
        <div class="preview-actions">
          <button class="btn" id="fullscreenAnaglyph" type="button" disabled>Fullscreen</button>
          <button class="btn" id="downloadAnaglyph" type="button" disabled>Anaglyph PNG</button>
        </div>
      </div>

      <div class="anaglyph-layout">
        <div class="anaglyph-controls">
          <label class="field">
            <span>Anaglyph Mode</span>
            <select id="anaglyphMode">
              <option value="dubois">Dubois Optimized</option>
              <option value="half">Half-Color</option>
              <option value="classic">Classic Channel Mix</option>
              <option value="gray">Grayscale</option>
            </select>
          </label>

          <div class="control">
            <div class="control-row">
              <label for="shiftX">Horizontal Shift</label>
              <output id="shiftXValue" for="shiftX">0 px</output>
            </div>
            <input id="shiftX" type="range" min="-200" max="200" step="1" value="0">
          </div>

          <div class="control">
            <div class="control-row">
              <label for="shiftY">Vertical Shift</label>
              <output id="shiftYValue" for="shiftY">0 px</output>
            </div>
            <input id="shiftY" type="range" min="-120" max="120" step="1" value="0">
          </div>

          <div class="control">
            <div class="control-row">
              <label for="intensity">Intensity</label>
              <output id="intensityValue" for="intensity">100 %</output>
            </div>
            <input id="intensity" type="range" min="0" max="200" step="1" value="100">
          </div>

          <div class="control">
            <div class="control-row">
              <label for="brightness">Brightness</label>
              <output id="brightnessValue" for="brightness">100 %</output>
            </div>
            <input id="brightness" type="range" min="0" max="200" step="1" value="100">
          </div>

          <div class="control">
            <div class="control-row">
              <label for="contrast">Contrast</label>
              <output id="contrastValue" for="contrast">100 %</output>
            </div>
            <input id="contrast" type="range" min="0" max="200" step="1" value="100">
          </div>

          <div class="control">
            <div class="control-row">
              <label for="saturation">Saturation</label>
              <output id="saturationValue" for="saturation">100 %</output>
            </div>
            <input id="saturation" type="range" min="0" max="200" step="1" value="100">
          </div>

          <div class="control">
            <div class="control-row">
              <label for="previewFps">Preview Frame Rate</label>
              <output id="previewFpsValue" for="previewFps">2 fps</output>
            </div>
            <input id="previewFps" type="range" min="1" max="10" step="1" value="2">
          </div>

          <div class="toggle-row">
            <label class="toggle">
              <input id="swapImages" type="checkbox">
              Swap Images
            </label>
            <label class="toggle">
              <input id="cropEdges" type="checkbox" checked>
              Crop Edges
            </label>
          </div>

          <div class="button-row">
            <button class="btn" id="autoAlign" type="button" disabled>Auto-Align</button>
            <button class="btn" id="resetAnaglyph" type="button">Reset</button>
          </div>
        </div>

        <div class="anaglyph-stage" id="anaglyphStage">
          <canvas id="anaglyphCanvas" width="1" height="1"></canvas>
          <p class="placeholder" id="anaglyphPlaceholder">The live anaglyph image appears here once both WebRTC streams are connected.</p>
        </div>
      </div>
    </section>

    <section class="panel capture-panel">
      <div class="panel-head">
        <div>
          <h2>Capture</h2>
          <p>This reads the current video frames in the admin browser and starts local downloads. The server never receives image data.</p>
        </div>
      </div>
      <div class="capture-actions">
        <label class="field">
          <span>Source Frames</span>
          <select id="captureFormat">
            <option value="jpg">JPG</option>
            <option value="png">PNG</option>
          </select>
        </label>
        <button class="btn btn-primary" id="captureButton" type="button" disabled>Take Photo</button>
      </div>
      <p class="message" id="captureMessage">Waiting for both cameras.</p>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Last Capture</h2>
          <p id="lastCaptureMeta">No capture in this browser yet.</p>
        </div>
      </div>
      <div class="result-grid" id="resultGrid">
        <article class="result-card">
          <div class="result-image empty">Left</div>
        </article>
        <article class="result-card">
          <div class="result-image empty">Right</div>
        </article>
      </div>
    </section>
  </main>

  <div class="fullscreen-preview" id="fullscreenPreview" role="dialog" aria-modal="true" aria-labelledby="fullscreenTitle" hidden>
    <div class="fullscreen-toolbar">
      <div>
        <p class="eyebrow">Live Preview</p>
        <h2 id="fullscreenTitle">Anaglyph 3D Preview</h2>
        <p id="fullscreenMeta">Waiting for both camera streams.</p>
      </div>
      <div class="fullscreen-actions">
        <button class="btn btn-primary" id="saveFullscreenAnaglyph" type="button" disabled>Save</button>
        <button class="btn btn-icon" id="closeFullscreenPreview" type="button" aria-label="Close fullscreen preview">X</button>
      </div>
    </div>
    <div class="fullscreen-canvas-wrap">
      <canvas id="fullscreenAnaglyphCanvas" width="1" height="1"></canvas>
      <p class="placeholder" id="fullscreenPlaceholder">The live anaglyph image appears here once both WebRTC streams are connected.</p>
    </div>
  </div>
</body>
</html>
