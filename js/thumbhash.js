const LUMINANCE_TERMS = 4 // Use 3 luminance terms (3x3 = 9 coefficients).
const CHROMINANCE_TERMS = 3 // Use 2 chrominance terms (2x2 = 4 coefficients for each, totaling 8 coefficients).

/**
 * Encodes an RGBA image to a ThumbHash optimized for squared profile photos (14 bytes).
 * 
 * @param w The width of the input image. Must be ≤100px.
 * @param h The height of the input image. Must be ≤100px.
 * @param rgba The pixels in the input image, row-by-row. Must have w*h*4 elements.
 * @returns The ThumbHash as a Uint8Array.
 */
export function rgbaToThumbHash(w, h, rgba) {
  if (w > 100 || h > 100) throw new Error(`${w}x${h} doesn't fit in 100x100`)
  let { PI, round, max, cos, abs } = Math

  // Determine the average color
  let avg_r = 0, avg_g = 0, avg_b = 0
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    let alpha = rgba[j + 3] / 255

    avg_r += alpha / 255 * rgba[j]
    avg_g += alpha / 255 * rgba[j + 1]
    avg_b += alpha / 255 * rgba[j + 2]
  }
  avg_r /= w * h
  avg_g /= w * h
  avg_b /= w * h

  // Remove the alpha handling (set all pixels as non-transparent)
  let l = [] // luminance
  let p = [] // yellow - blue
  let q = [] // red - green

  // Convert the image from RGBA to LPQ (no alpha channel)
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    let alpha = rgba[j + 3] / 255

    let r = avg_r * (1 - alpha) + alpha / 255 * rgba[j]
    let g = avg_g * (1 - alpha) + alpha / 255 * rgba[j + 1]
    let b = avg_b * (1 - alpha) + alpha / 255 * rgba[j + 2]

    l[i] = (r + g + b) / 3
    p[i] = (r + g) / 2 - b
    q[i] = r - g
  }

  // Encode using the DCT into DC (constant) and normalized AC (varying) terms
  let encodeChannel = (channel, nx, ny) => {
    let dc = 0, ac = [], scale = 0, fx = []
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = 0; cx * ny < nx * (ny - cy); cx++) {
        let f = 0
        for (let x = 0; x < w; x++)
          fx[x] = cos(PI / w * cx * (x + 0.5))
        for (let y = 0; y < h; y++)
          for (let x = 0, fy = cos(PI / h * cy * (y + 0.5)); x < w; x++)
            f += channel[x + y * w] * fx[x] * fy
        f /= w * h
        if (cx || cy) {
          ac.push(f)
          scale = max(scale, abs(f))
        } else {
          dc = f
        }
      }
    }
    if (scale)
      for (let i = 0; i < ac.length; i++)
        ac[i] = 0.5 + 0.5 / scale * ac[i]
    return [dc, ac, scale]
  }

  let [l_dc, l_ac, l_scale] = encodeChannel(l, LUMINANCE_TERMS, LUMINANCE_TERMS)  // Adjust to 3x3 for luminance
  let [p_dc, p_ac, p_scale] = encodeChannel(p, CHROMINANCE_TERMS, CHROMINANCE_TERMS)  // Adjust to 2x2 for chrominance
  let [q_dc, q_ac, q_scale] = encodeChannel(q, CHROMINANCE_TERMS, CHROMINANCE_TERMS)  // Adjust to 2x2 for chrominance

  // Write the constants
  let header24 = round(63 * l_dc) | (round(31.5 + 31.5 * p_dc) << 6) | (round(31.5 + 31.5 * q_dc) << 12) | (round(31 * l_scale) << 18)
  let header16 = (round(63 * p_scale) << 3) | (round(63 * q_scale) << 9)
  let hash = [header24 & 255, (header24 >> 8) & 255, header24 >> 16, header16 & 255, header16 >> 8]

  // Write the varying factors
  let ac_start = 5
  let ac_index = 0
  for (let ac of [l_ac, p_ac, q_ac])
    for (let f of ac)
      hash[ac_start + (ac_index >> 1)] |= round(15 * f) << ((ac_index++ & 1) << 2)

  return new Uint8Array(hash)
}

/**
 * Decodes a ThumbHash to an RGBA image.
 * 
 * @param hash The bytes of the ThumbHash.
 * @returns The width, height, and pixels of the rendered placeholder image.
 */
export function thumbHashToRGBA(hash) {
  let { PI, min, max, cos, round } = Math

  // Read the constants
  let header24 = hash[0] | (hash[1] << 8) | (hash[2] << 16)
  let header16 = hash[3] | (hash[4] << 8)
  let l_dc = (header24 & 63) / 63
  let p_dc = ((header24 >> 6) & 63) / 31.5 - 1
  let q_dc = ((header24 >> 12) & 63) / 31.5 - 1
  let l_scale = ((header24 >> 18) & 31) / 31
  let p_scale = ((header16 >> 3) & 63) / 63
  let q_scale = ((header16 >> 9) & 63) / 63
  let rgba = new Uint8Array(32 * 32 * 4), fx = [], fy = []

  // Read the varying factors
  let ac_start = 5
  let ac_index = 0
  let decodeChannel = (nx, ny, scale) => {
    let ac = []
    for (let cy = 0; cy < ny; cy++)
      for (let cx = cy ? 0 : 1; cx * ny < nx * (ny - cy); cx++)
        ac.push((((hash[ac_start + (ac_index >> 1)] >> ((ac_index++ & 1) << 2)) & 15) / 7.5 - 1) * scale)
    return ac
  }

  let l_ac = decodeChannel(LUMINANCE_TERMS, LUMINANCE_TERMS, l_scale)
  let p_ac = decodeChannel(CHROMINANCE_TERMS, CHROMINANCE_TERMS, p_scale * 1.25)
  let q_ac = decodeChannel(CHROMINANCE_TERMS, CHROMINANCE_TERMS, q_scale * 1.25)

  // Decode using the DCT into RGB
  let w = 32, h = 32
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      let l = l_dc, p = p_dc, q = q_dc

      // Precompute the coefficients
      for (let cx = 0, n = LUMINANCE_TERMS; cx < n; cx++)
        fx[cx] = cos(PI / w * (x + 0.5) * cx)
      for (let cy = 0, n = LUMINANCE_TERMS; cy < n; cy++)
        fy[cy] = cos(PI / h * (y + 0.5) * cy)

      // Decode L
      for (let cy = 0, j = 0; cy < LUMINANCE_TERMS; cy++)
        for (let cx = cy ? 0 : 1, fy2 = fy[cy] * 2; cx * LUMINANCE_TERMS < LUMINANCE_TERMS * (LUMINANCE_TERMS - cy); cx++, j++)
          l += l_ac[j] * fx[cx] * fy2

      // Decode P and Q
      for (let cy = 0, j = 0; cy < CHROMINANCE_TERMS; cy++)
        for (let cx = cy ? 0 : 1, fy2 = fy[cy] * 2; cx * CHROMINANCE_TERMS < CHROMINANCE_TERMS * (CHROMINANCE_TERMS - cy); cx++, j++) {
          let f = fx[cx] * fy2
          p += p_ac[j] * f
          q += q_ac[j] * f
        }

      // Convert to RGB
      let b = l - 2 / 3 * p
      let r = (3 * l - b + q) / 2
      let g = r - q
      rgba[i] = max(0, 255 * min(1, r))
      rgba[i + 1] = max(0, 255 * min(1, g))
      rgba[i + 2] = max(0, 255 * min(1, b))
      rgba[i + 3] = 255
    }
  }

  return { w, h, rgba }
}

/**
 * Extracts the average color from a ThumbHash. RGB is not be premultiplied by A.
 *
 * @param hash The bytes of the ThumbHash.
 * @returns The RGBA values for the average color. Each value ranges from 0 to 1.
 */
export function thumbHashToAverageRGBA(hash) {
  let { min, max } = Math
  let header = hash[0] | (hash[1] << 8) | (hash[2] << 16)
  let l = (header & 63) / 63
  let p = ((header >> 6) & 63) / 31.5 - 1
  let q = ((header >> 12) & 63) / 31.5 - 1
  let hasAlpha = header >> 23
  let a = hasAlpha ? (hash[5] & 15) / 15 : 1
  let b = l - 2 / 3 * p
  let r = (3 * l - b + q) / 2
  let g = r - q
  return {
    r: max(0, min(1, r)),
    g: max(0, min(1, g)),
    b: max(0, min(1, b)),
    a
  }
}

/**
 * Encodes an RGBA image to a PNG data URL. RGB should not be premultiplied by
 * A. This is optimized for speed and simplicity and does not optimize for size
 * at all. This doesn't do any compression (all values are stored uncompressed).
 *
 * @param w The width of the input image. Must be ≤100px.
 * @param h The height of the input image. Must be ≤100px.
 * @param rgba The pixels in the input image, row-by-row. Must have w*h*4 elements.
 * @returns A data URL containing a PNG for the input image.
 */
export function rgbaToDataURL(w, h, rgba) {
  let row = w * 4 + 1
  let idat = 6 + h * (5 + row)
  let bytes = [
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0,
    w >> 8, w & 255, 0, 0, h >> 8, h & 255, 8, 6, 0, 0, 0, 0, 0, 0, 0,
    idat >>> 24, (idat >> 16) & 255, (idat >> 8) & 255, idat & 255,
    73, 68, 65, 84, 120, 1
  ]
  let table = [
    0, 498536548, 997073096, 651767980, 1994146192, 1802195444, 1303535960,
    1342533948, -306674912, -267414716, -690576408, -882789492, -1687895376,
    -2032938284, -1609899400, -1111625188
  ]
  let a = 1, b = 0
  for (let y = 0, i = 0, end = row - 1; y < h; y++, end += row - 1) {
    bytes.push(y + 1 < h ? 0 : 1, row & 255, row >> 8, ~row & 255, (row >> 8) ^ 255, 0)
    for (b = (b + a) % 65521; i < end; i++) {
      let u = rgba[i] & 255
      bytes.push(u)
      a = (a + u) % 65521
      b = (b + a) % 65521
    }
  }
  bytes.push(
    b >> 8, b & 255, a >> 8, a & 255, 0, 0, 0, 0,
    0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
  )
  for (let [start, end] of [[12, 29], [37, 41 + idat]]) {
    let c = ~0
    for (let i = start; i < end; i++) {
      c ^= bytes[i]
      c = (c >>> 4) ^ table[c & 15]
      c = (c >>> 4) ^ table[c & 15]
    }
    c = ~c
    bytes[end++] = c >>> 24
    bytes[end++] = (c >> 16) & 255
    bytes[end++] = (c >> 8) & 255
    bytes[end++] = c & 255
  }
  return 'data:image/png;base64,' + btoa(String.fromCharCode(...bytes))
}

/**
 * Decodes a ThumbHash to a PNG data URL. This is a convenience function that
 * just calls "thumbHashToRGBA" followed by "rgbaToDataURL".
 *
 * @param hash The bytes of the ThumbHash.
 * @returns A data URL containing a PNG for the rendered ThumbHash.
 */
export function thumbHashToDataURL(hash) {
  let image = thumbHashToRGBA(hash)
  return rgbaToDataURL(image.w, image.h, image.rgba)
}
