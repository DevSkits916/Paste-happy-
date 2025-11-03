import { Buffer } from 'node:buffer';
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), inlineBundlePlugin()],
  build: {
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});

function inlineBundlePlugin(): Plugin {
  return {
    name: 'inline-bundle-plugin',
    enforce: 'post',
    apply: 'build',
    generateBundle(_options, bundle) {
      const htmlFile = Object.keys(bundle).find((file) => file.endsWith('.html'));
      if (!htmlFile) return;
      const htmlAsset = bundle[htmlFile];
      if (!htmlAsset || htmlAsset.type !== 'asset') return;

      let html =
        typeof htmlAsset.source === 'string'
          ? htmlAsset.source
          : Buffer.from(htmlAsset.source ?? '').toString('utf8');
      const cssSnippets: string[] = [];
      const jsSnippets: string[] = [];

      for (const [fileName, asset] of Object.entries(bundle)) {
        if (fileName === htmlFile) continue;
        if (asset.type === 'asset' && fileName.endsWith('.css')) {
          const css = typeof asset.source === 'string' ? asset.source : Buffer.from(asset.source).toString('utf8');
          cssSnippets.push(css);
          const pattern = new RegExp(`<link[^>]+href="[^"]*${escapeRegExp(fileName)}"[^>]*>`, 'g');
          html = html.replace(pattern, '');
          delete bundle[fileName];
        }
        if (asset.type === 'chunk' && fileName.endsWith('.js')) {
          jsSnippets.push(asset.code);
          const pattern = new RegExp(`<script[^>]+src="[^"]*${escapeRegExp(fileName)}"[^>]*></script>`, 'g');
          html = html.replace(pattern, '');
          delete bundle[fileName];
        }
      }

      if (cssSnippets.length) {
        const styles = `<style>${cssSnippets.join('\n')}</style>`;
        html = html.replace('</head>', `${styles}</head>`);
      }

      if (jsSnippets.length) {
        const scripts = `<script type="module">${jsSnippets.join('\n')}</script>`;
        html = html.replace('</body>', `${scripts}</body>`);
      }

      htmlAsset.source = html.trim();
    },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
