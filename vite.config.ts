import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 相対パスにしておくと、どこに置いても（後でCapacitorでAPK化しても）動く
  base: './',
});
