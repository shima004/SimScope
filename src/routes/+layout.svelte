<script lang="ts">
  import favicon from "$lib/assets/favicon.svg";
  import { initLocale, locale, t } from "$lib/i18n";
  import { onMount } from "svelte";
  import "../app.css";

  let { children } = $props();

  onMount(initLocale);

  $effect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = $locale;
    }
  });
</script>

<svelte:head>
  <title>{$t("app.title")}</title>
  <link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
