// Place any global data in this file.
// You can import this data from anywhere in your site by using the `import` keyword.

export const SITE_TITLE = "Hritesh Sonawane";
export const SITE_DESCRIPTION =
  "Welcome to my blog! I write about security engineering.";
export const TWITTER_HANDLE = "@yourtwitterhandle";
export const MY_NAME = "Hritesh Sonawane";

// setup in astro.config.mjs
const BASE_URL = new URL(import.meta.env.SITE);
export const SITE_URL = BASE_URL.origin;
