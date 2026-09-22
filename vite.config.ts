import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_BACKEND_TARGET || "http://127.0.0.1:8080";
  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: false,
      proxy: {
        "/backend": {
          target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/backend/, ""),
        },
      },
    },
  };
});
