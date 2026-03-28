export function getContrastColor(hexColor: string): string {
  // Remove # if present
  const hex = hexColor.startsWith('#') ? hexColor.slice(1) : hexColor;
  
  // Parse RGB
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  
  if (isNaN(r) || isNaN(g) || isNaN(b)) return '#ffffff';
  
  // Calculate luminance (standard formula)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  // Return black for light colors, white for dark colors
  return luminance > 0.55 ? '#000000' : '#ffffff';
}
