# Truth Lens

Truth Lens searches published fact-check reviews and screens images with a vision model running on your own computer.

## Start the app on Windows

1. Install Python 3.11 or newer.
2. In PowerShell, open this folder and install dependencies:

   ```powershell
   python -m pip install -r requirements.txt
   ```

3. Optional, for published fact-check search: create a Google Cloud API key, enable the Fact Check Tools API for its project, and set the key in the same PowerShell window. Do not put the key in a source file:

   ```powershell
   $env:GOOGLE_FACT_CHECK_API_KEY = "your-key"
   ```

   Without a key, image screening still works, but fact-check search reports that it is not configured.
4. Run `start.bat` and open <http://127.0.0.1:8000>.
5. On the first image analysis, the server downloads the approximately 343 MB model from Hugging Face. Later runs use the local model cache.

The requirements use the official CPU-only PyTorch wheel, so image analysis runs on the processor without needing a CUDA/GPU setup.

Do not open `index.html` directly: the analyzer endpoints require the local server.

## What the results mean

- **Claim review:** uses Google's Fact Check Tools API to find published claim reviews. It shows the reviewer's own rating and links to the source. A matched review can be outdated or refer to a different claim; no match is not evidence that a claim is true. The text is sent to Google only when you request a search.
- **Image screen:** runs `NYUAD-ComNets/NYUAD_AI-generated_images_detector` locally. Its classes are DALL·E, real, and Stable Diffusion; the displayed AI score combines the two generator classes. Its scores are model outputs, not calibrated probabilities. The model was trained on a limited set of generators and does not reliably identify all AI images, edits, or deepfakes. Image bytes stay on this computer.
- **Language cues and metadata:** supplementary signals only. Neither those signals nor model scores prove something is true, false, authentic, or manipulated.

Image model: [NYUAD AI-generated images detector](https://huggingface.co/NYUAD-ComNets/NYUAD_AI-generated_images_detector), Apache-2.0. It reports 97.4% accuracy on its own validation set; that figure should not be assumed to apply to images in the wild.
