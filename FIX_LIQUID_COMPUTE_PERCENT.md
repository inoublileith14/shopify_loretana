**Fix Compute Percent Mapping in Liquid Theme**

- **Goal:** Replace the client-side `computePercent(tx, ty, scale)` function in your Shopify Liquid/JS section so the `x` and `y` values sent to the backend match the backend's center-based percentage semantics (50 = centered). This fixes mismatches where the saved shaped image isn't aligned with the preview.

**Where to edit**
- File: the theme section Liquid file you shared (the file containing `preview-svg` and the JS). Search for the function name:
  - `function computePercent(tx, ty, scale)`
- The function is used right before the code that builds the `FormData` and POSTs to `POST /customizer/upload` (look for `formData.append('x', String(perc.px));`).

**Problem summary (short)**
- Current code forces a minimum `maxTranslate` value (e.g. `Math.max(viewBox/2, ...)`) which biases the percent mapping. When the image scale = 1 the UI should produce `x=50, y=50` for centered; the forced minimum makes center map to a different number.
- Backend expects center = 50 and converts percentage to pixel positions on a 500x500 canvas.

**Exact change (paste this block into your editor, replacing the entire existing `computePercent` function):**

```javascript
function computePercent(tx, ty, scale) {
  try {
    var viewBoxW = 200, viewBoxH = 220;
    var imageWidthUnits = viewBoxW * scale;
    var imageHeightUnits = viewBoxH * scale;

    // true max pan is half the extra image area (no forced minimum)
    var maxTranslateX = Math.max(0, (imageWidthUnits - viewBoxW) / 2);
    var maxTranslateY = Math.max(0, (imageHeightUnits - viewBoxH) / 2);

    var px = 50, py = 50;
    if (maxTranslateX > 0) {
      px = ((tx + maxTranslateX) / (2 * maxTranslateX)) * 100;
    }
    if (maxTranslateY > 0) {
      py = ((ty + maxTranslateY) / (2 * maxTranslateY)) * 100;
    }

    px = Math.max(0, Math.min(100, px));
    py = Math.max(0, Math.min(100, py));

    return { px: Math.round(px), py: Math.round(py) };
  } catch (err) {
    return { px: 50, py: 50 };
  }
}
```

**Why this fixes it (one line)**
- It uses the true half-extra-image-area as the pan limit (no artificial minimum), so when the image is not zoomed the center maps to 50, and edges map to 0 or 100 consistently.

**Verification steps**
1. Save the Liquid file and reload the product page.
2. Upload an image in the preview, pan/zoom to a non-centered position, click **Confirm & Save Engraving**.
3. In browser DevTools → Network, inspect the `POST /customizer/upload` request and check the form fields:
   - `x` and `y` should be integers between `0–100` (center approx `50`)
   - `zoom` should be a decimal like `1`, `0.8`, `1.3`
4. Fetch the shaped preview using:
   - `GET https://<your-backend>/customizer/shape/<sessionId>/latest` and confirm the shaped image aligns with the UI preview.

**Optional debug (backend)**
- If you still see mismatches, add a temporary log in `src/customizer/customizer.controller.ts` inside `uploadImage` to print `body.x`, `body.y`, `body.zoom` and compare with values shown in DevTools.

**Notes for AI editor**
- Only replace the function body. Keep function name and surrounding whitespace intact.
- The function may appear multiple times (hosting vs option1). Replace the one used by the `Confirm & Save Engraving` flow — search for `computePercent(` and the occurrence used before building `formData` appended with `x` and `y`.

If you want, I can also produce the one-line backend log patch to confirm received values; tell me and I'll add it next.