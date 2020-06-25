<h1 align="center">
  <br>
  <a href="https://codewyng.io"><img src="https://storage.googleapis.com/codewyng-public/marquee-promo-tile.png" alt="CodeWyng" width="800"></a>
  <br>
  CodeWyng
  <br>
</h1>

<h4 align="center">Chrome extension for browsing GitHub like an IDE</h4>

<p align="center">
  <a href="https://chrome.google.com/webstore/detail/njkkfaliiinmkcckepjdmgbmjljfdeee">
    <img src="https://img.shields.io/chrome-web-store/users/njkkfaliiinmkcckepjdmgbmjljfdeee.svg"/>
  </a>
  <a href="https://chrome.google.com/webstore/detail/njkkfaliiinmkcckepjdmgbmjljfdeee">
    <img src="https://img.shields.io/chrome-web-store/rating/njkkfaliiinmkcckepjdmgbmjljfdeee.svg"/>
  </a>
  <a href="https://chrome.google.com/webstore/detail/njkkfaliiinmkcckepjdmgbmjljfdeee">
    <img src="https://img.shields.io/chrome-web-store/v/njkkfaliiinmkcckepjdmgbmjljfdeee.svg"/>
  </a>
</p>

<p align="center">
  <a href="https://codewyng.io">CodeWyng.io</a> •
  <a href="https://chrome.google.com/webstore/detail/njkkfaliiinmkcckepjdmgbmjljfdeee"><img src="readme/chrome-web-store.png" align="center" width=20/> Chrome Web Store</a> •
  <a href="https://github.com/CodeWyng/codewyng">Issues</a> •
  <a href="https://twitter.com/CodeWyng">@CodeWyng</a> •
  <a href="mailto:mail@codewyng.io">mail@codewyng.io</a>
  <br/>
  <br/>
  <img src="readme/demo.gif"/>
</p>

# Features

<img align="right" width="300" src="https://storage.googleapis.com/codewyng-public/hover.png">

**Hover documentation:** hovering over a variable shows its docstring.

<br>
<br>
<br>
<br>
<br>
<br>
<br>
<br>

<img align="right" width="300" src="https://storage.googleapis.com/codewyng-public/definition.png">

**Jump-to-definition:** clicking on a variable takes you to its definition (works across files, too!).

<br>
<br>
<br>
<br>
<br>
<br>
<br>

<img align="right" width="300" src="https://storage.googleapis.com/codewyng-public/references.png">

**Find-references:** clicking on a definition opens a list of references.

<br>
<br>
<br>
<br>
<br>
<br>
<br>
<br>

<img align="right" width="300" src="https://storage.googleapis.com/codewyng-public/search.png">

**Quick search:** <kbd>Cmd+/</kbd> or <kbd>Alt+/</kbd> opens an exact punctuation-aware search box.

<br>
<br>
<br>
<br>
<br>
<br>
<br>

Install CodeWyng from the <a href="https://chrome.google.com/webstore/detail/njkkfaliiinmkcckepjdmgbmjljfdeee"><img src="readme/chrome-web-store.png" align="center" width=20/> Chrome Web Store</a>!

# Development

1. Install Node.js and `npm install -g yarn`
2. Run `./dev`
3. Open chrome://extensions/
4. Turn on **Developer mode**
5. Click **Load unpacked**
6. Select the `dist-dev` directory created by `./dev` above
7. Try hovering on variables in https://github.com/gorilla/mux/blob/master/mux.go
