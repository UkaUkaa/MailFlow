"""Sanitization of untrusted email HTML (first layer; the client adds a sandboxed iframe + CSP)."""

from __future__ import annotations

import html
import re
from dataclasses import dataclass

import nh3

_TAGS = {
    "a", "abbr", "address", "article", "b", "bdi", "bdo", "blockquote", "br", "caption", "center",
    "cite", "code", "col", "colgroup", "dd", "del", "details", "dfn", "div", "dl", "dt", "em",
    "figcaption", "figure", "font", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr",
    "i", "img", "ins", "kbd", "li", "main", "mark", "ol", "p", "pre", "q", "s", "samp", "section",
    "small", "span", "strike", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot",
    "th", "thead", "time", "tr", "tt", "u", "ul", "var", "wbr",
}  # fmt: skip
_GLOBAL_ATTRS = {"style", "dir", "lang", "title", "align", "valign", "bgcolor", "width", "height"}
_ATTRS: dict[str, set[str]] = {
    "*": _GLOBAL_ATTRS,
    "a": {"href", "name"},
    "img": {"src", "alt", "border"},
    "table": {"border", "cellpadding", "cellspacing", "role", "summary"},
    "td": {"colspan", "rowspan", "nowrap"},
    "th": {"colspan", "rowspan", "scope", "nowrap"},
    "col": {"span"},
    "colgroup": {"span"},
    "font": {"color", "face", "size"},
    "ol": {"start", "type"},
    "ul": {"type"},
    "blockquote": {"cite"},
    "time": {"datetime"},
}
# No positioning, no url()-capable shorthands (background, list-style, content, behavior ...).
_STYLE_PROPERTIES = {
    "background-color", "border", "border-bottom", "border-bottom-color", "border-bottom-style",
    "border-bottom-width", "border-collapse", "border-color", "border-left", "border-left-color",
    "border-left-style", "border-left-width", "border-radius", "border-right",
    "border-right-color", "border-right-style", "border-right-width", "border-spacing",
    "border-style", "border-top", "border-top-color", "border-top-style", "border-top-width",
    "border-width", "color", "display", "font", "font-family", "font-size", "font-style",
    "font-variant", "font-weight", "height", "letter-spacing", "line-height", "list-style-type",
    "margin", "margin-bottom", "margin-left", "margin-right", "margin-top", "max-height",
    "max-width", "min-height", "min-width", "padding", "padding-bottom", "padding-left",
    "padding-right", "padding-top", "table-layout", "text-align", "text-decoration",
    "text-indent", "text-transform", "vertical-align", "white-space", "width", "word-break",
    "word-wrap", "overflow-wrap",
}  # fmt: skip

_LINK_SCHEMES = ("http://", "https://", "mailto:")
_DATA_IMAGE = re.compile(r"^data:image/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$", re.I)
_CSS_DANGEROUS = re.compile(r"url\s*\(|expression\s*\(|@import|javascript:", re.I)
MAX_HTML_CHARS = 2_000_000


@dataclass(frozen=True, slots=True)
class SanitizedHtml:
    html: str
    has_remote_images: bool


def sanitize_email_html(raw: str) -> SanitizedHtml:
    """Return markup safe to place in a sandboxed frame. Never raises on hostile input."""
    remote = False

    def attribute_filter(tag: str, attr: str, value: str) -> str | None:
        nonlocal remote
        stripped = value.strip()
        lowered = stripped.lower()
        if attr == "href":
            return stripped if lowered.startswith(_LINK_SCHEMES) else None
        if attr == "src":
            if tag != "img":
                return None
            if lowered.startswith(("http://", "https://")):
                remote = True
                return stripped
            if lowered.startswith("cid:") or _DATA_IMAGE.match(stripped):
                return stripped
            return None
        if attr == "style":
            return None if _CSS_DANGEROUS.search(value) else value
        if attr == "cite":
            return stripped if lowered.startswith(("http://", "https://")) else None
        return value

    cleaned = nh3.clean(
        raw[:MAX_HTML_CHARS],
        tags=_TAGS,
        clean_content_tags={
            "script",
            "style",
            "noscript",
            "iframe",
            "object",
            "embed",
            "svg",
            "math",
            "template",
            "title",
            "head",
            "form",
            "textarea",
            "select",
        },
        attributes=_ATTRS,
        attribute_filter=attribute_filter,
        filter_style_properties=_STYLE_PROPERTIES,
        url_schemes={"http", "https", "mailto", "cid", "data"},
        strip_comments=True,
        link_rel="noopener noreferrer nofollow",
        set_tag_attribute_values={"a": {"target": "_blank"}},
    )
    return SanitizedHtml(html=cleaned, has_remote_images=remote)


def text_to_snippet(text: str, limit: int = 200) -> str:
    collapsed = re.sub(r"\s+", " ", text).strip()
    return collapsed[:limit]


def html_to_text(sanitized_html: str) -> str:
    """Rough plain-text projection of already-sanitized HTML, for search and snippets."""
    text = re.sub(r"(?i)<br\s*/?>|</(p|div|tr|li|h[1-6]|blockquote)>", "\n", sanitized_html)
    text = nh3.clean(text, tags=set())
    return html.unescape(text).strip()
