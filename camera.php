<?php
$side = strtolower((string)($_GET['side'] ?? 'a'));
$side = in_array($side, ['a', 'b'], true) ? $side : 'a';
$label = $side === 'a' ? 'Camera A / Left' : 'Camera B / Right';
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Live 3D Anaglyph Generator - <?php echo htmlspecialchars($label, ENT_QUOTES, 'UTF-8'); ?></title>
  <link rel="stylesheet" href="assets/style.css">
  <script>
    window.CAMERA_SIDE = <?php echo json_encode($side); ?>;
  </script>
  <script src="assets/camera.js" defer></script>
</head>
<body class="camera-page">
  <main class="camera-shell">
    <video id="cameraVideo" playsinline muted autoplay></video>

    <div class="camera-overlay">
      <div class="camera-header">
        <div>
          <p class="eyebrow">Camera</p>
          <h1><?php echo htmlspecialchars($label, ENT_QUOTES, 'UTF-8'); ?></h1>
        </div>
        <span class="server-status is-warn" id="cameraStatus">Initializing ...</span>
      </div>

      <div class="camera-controls">
        <label class="field">
          <span>Camera</span>
          <select id="facingMode">
            <option value="environment">Rear Camera</option>
            <option value="user">Front Camera</option>
          </select>
        </label>
        <label class="field">
          <span>Resolution</span>
          <select id="resolution">
            <option value="1920x1080">1920 x 1080</option>
            <option value="1280x720">1280 x 720</option>
            <option value="3840x2160">3840 x 2160</option>
          </select>
        </label>
        <button class="btn btn-primary" id="startCamera" type="button">Start Camera</button>
        <button class="btn" id="restartCamera" type="button">Restart Camera</button>
      </div>

      <p class="camera-note" id="cameraNote">Safari asks for camera access only after a tap. This page must be loaded over HTTPS. Images are not uploaded to the server.</p>
    </div>
  </main>
</body>
</html>
