import { useColorScheme } from 'react-native';

export const darkColors = {
  background: '#1a1a2e',
  surface: '#2a2a4a',
  surfaceAlt: '#1e1e3a',
  border: '#3a3a5a',
  text: '#e0c9ff',
  subtext: '#9b8ab8',
  subtextMuted: '#6a6a8a',
  accent: '#7c4dff',
  accentMuted: '#3d2b6b',
  accentText: '#b89eff',
  danger: '#ff6b6b',
  success: '#4caf50',
  placeholder: '#666',
  inputBg: '#2a2a4a',
};

export const lightColors = {
  background: '#f5f0ff',
  surface: '#ffffff',
  surfaceAlt: '#ede8fa',
  border: '#d0c4ea',
  text: '#1a1a2e',
  subtext: '#5a4878',
  subtextMuted: '#8a7aaa',
  accent: '#7c4dff',
  accentMuted: '#ede0ff',
  accentText: '#5c2db8',
  danger: '#c62828',
  success: '#2e7d32',
  placeholder: '#b0a0c8',
  inputBg: '#f0ebff',
};

export type ThemeColors = typeof darkColors;

export function useTheme(): ThemeColors {
  const scheme = useColorScheme();
  return scheme === 'dark' ? darkColors : lightColors;
}
