/* eslint-disable turbo/no-undeclared-env-vars */
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: 'https://hritesh-sonawane.github.io',
  integrations: [sitemap()],
});