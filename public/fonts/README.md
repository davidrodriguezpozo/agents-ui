# Symbols Nerd Font Mono

`SymbolsNerdFontMono-Regular.woff` — the icon glyphs a shell prompt draws with,
and nothing else. It is here so the terminal in the Work view shows a
powerlevel10k or starship prompt as symbols rather than tofu boxes on a machine
with no patched font installed.

**It is rarely downloaded.** `--font-terminal` in `app/assets/css/main.css` asks
for locally installed Nerd Fonts first — MesloLGS NF, JetBrainsMono NF and the
rest — and the `@font-face` here is scoped with `unicode-range` to the icon
blocks. A reader who already has one of those fonts never fetches this file, and
a reader who does not fetches it once, for the icons alone; every letter and
digit still comes from Geist Mono.

## Provenance

Taken from [ryanoasis/nerd-fonts][nf], `patched-fonts/NerdFontsSymbolsOnly/`,
and converted from TrueType to WOFF 1.0 losslessly — every table is the source
table, zlib-compressed, and round-trips byte for byte. WOFF rather than WOFF2
because WOFF2's Brotli font transform needs a toolchain this project does not
have and will not take on; WOFF is supported by every browser this app runs in,
and the file is served compressed anyway.

To refresh it:

```sh
curl -sSLo symbols.ttf \
  https://github.com/ryanoasis/nerd-fonts/raw/master/patched-fonts/NerdFontsSymbolsOnly/SymbolsNerdFontMono-Regular.ttf
node scripts/ttf-to-woff.mjs symbols.ttf public/fonts/SymbolsNerdFontMono-Regular.woff
```

## Licence

The Nerd Fonts patcher is MIT. The glyphs are drawn from several icon sets that
carry their own licences — Font Awesome (CC BY 4.0 / SIL OFL 1.1), Material
Design Icons (Apache 2.0), Octicons (MIT), Devicons (MIT), Powerline (MIT),
Weather Icons (SIL OFL 1.1) among them. See the [Nerd Fonts licence notes][nf]
for the full list.

[nf]: https://github.com/ryanoasis/nerd-fonts
