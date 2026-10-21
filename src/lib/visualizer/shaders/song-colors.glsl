// Zeta "song colours": repaints another visualizer's image with the current
// song's palette while keeping its shapes and lighting. Brightness maps through
// the song's colours (deep colour -> mid -> accent -> white); which colour an
// area leans towards drifts slowly across the screen, and parts the original
// coloured differently stay distinct. Kicks brighten it.
//   iChannel0 = the visualizer's image.

vec3 saturate3(vec3 c, float s) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), c, s);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 q = fragCoord / iResolution.xy;
  vec3 src = texture(iChannel0, q).rgb;
  float l = clamp(dot(src, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.5);

  // Which of the song's colours this spot leans towards: a slow diagonal drift,
  // mixed with the original's own red-vs-blue split so its regions stay apart.
  float drift = 0.5 + 0.5 * sin((q.x * 1.3 - q.y * 0.9) * 3.0 + iTime * 0.25 + iRot * 0.3);
  float split = clamp((src.r - src.b) / max(l, 0.05), -1.0, 1.0) * 0.5 + 0.5;
  float pick = mix(drift, split, 0.45);

  vec3 mid = mix(iColor0, iColor1, pick);
  vec3 high = mix(iAccent, iColor1, pick * 0.5);
  vec3 col = mix(iColor2 * 0.2, mid, smoothstep(0.0, 0.35, l));
  col = mix(col, high, smoothstep(0.3, 0.7, l));
  col = mix(col, vec3(1.0), smoothstep(0.78, 1.15, l));

  // A gradient map flattens contrast a little; restore it from the original.
  col = saturate3(col, 1.25) * (0.75 + 0.6 * l) * (1.0 + 0.15 * iBeat);
  // Keep a hint of the original so grey covers don't wash it out entirely.
  col = mix(src, col, 0.88);

  fragColor = vec4(max(col, 0.0), 1.0);
}
