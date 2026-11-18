/**
 * Whether the navigation column is expanded. Kept in `localStorage` under `mf-sidebar`
 * (`"false"` = expanded; anything else = the collapsed icon rail) and mirrored on
 * `<html data-nav>` so that plain CSS can size the column.
 */
export const NAV_STORAGE_KEY = "mf-sidebar";

/** Runs before first paint, so a stored "expanded" never flashes as the collapsed rail. */
export const navInitScript = `(function(){try{document.documentElement.dataset.nav=localStorage.getItem(${JSON.stringify(NAV_STORAGE_KEY)})==="false"?"expanded":"collapsed";}catch(e){}})();`;
