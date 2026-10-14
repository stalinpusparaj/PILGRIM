# PILGRIM: THE NARROW WAY — attraction asset prompt pack (for Google Flow / Imagen / Veo)

Paste these into Flow by hand. Every prompt locks the game's own style (GDD 2.11) and palette so the
results match the procedural art. Keep outputs in `promo/` (never in `src/` or `public/`: the build's
asset check stays green and the game stays 100 % code-generated; promo art is for store pages, trailers
and social).

## Style lock (prepend to every prompt)

> Low-poly toy diorama. Flat-shaded faceted geometry with vertex colours only, no image textures.
> Chunky rounded friendly shapes. Characters about 2.5 heads tall with big round heads, dot eyes,
> simple mouths, expressive eyebrows, mitten hands, stubby legs. One warm sun plus a sky/ground
> hemisphere light. Gentle gradient sky, soft fog, puffy low-poly clouds. Looks like a painted wooden
> toy. Kid-friendly, ESRB E. Original design, no likeness to any film, show or game character.
> No text, no watermark (unless the prompt asks for text).

## A. Key art and store

1. **Hero key art (16:9).** A small pilgrim in a brown tunic #8A6A4A, brown trousers #5B4636 and a rope
   belt #C9A66B, leaning forward under a huge lumpy rope-tied sack, walks a narrow glowing golden dirt
   path with little edge stones through rolling green faceted hills toward one tiny shining light on the
   far horizon. Dusk sky from plum #6B4A5E to warm orange #E8A26B. Cinematic depth, hopeful.
2. **Vertical poster (9:16).** Same pilgrim looking up; the path climbs past a small wooden wicket gate
   #8A5A3B in a cream stone wall #C9BBA0 to a shining city on a far hill under a dawn sky #F7C9A8 to
   #FFE9A8. Leave empty sky at the top for the logo.
3. **Store banner with logo (16:9).** Left two-thirds: the dusk landscape from a crooked walled town with
   smoking chimneys toward the far light. Right third: chunky serif text **PILGRIM** in cream #FFF4DC
   with a deep-gold #C4861B 3D offset shadow, below it tracked gold #FFD27A text **THE NARROW WAY**, and
   above the title a small emblem of a gate on a path under a rising sun. Spell the text exactly.
4. **App icon (1:1).** The emblem alone: a small wooden gate on a winding path under a rising golden
   sun, low-poly 3D, on a rounded cream square with a thick gold rim. Bold and readable at 64 px.
5. **Title backdrop (16:9).** Rolling green hills #8DBF6A, cone and round low-poly trees, a wooden
   fence, the golden path winding to one brilliant far light under a sky from blue-violet #5E6FA8 to
   peach #F2C9A0, floating light motes. Keep the left third calm for the menu. No characters.

## B. Chapter cards (16:9, one each)

6. **I. The City of Destruction.** Crooked crowded walled town at dusk, leaning timber houses #6E5D50,
   chimney smoke, stone #8C8577, a gate in the wall, fields outside, one tiny far light #FFE8A3.
7. **II. The Slough of Despond.** Wide gloopy bog in grey drizzle, mud #5B4A35, crooked reeds #8A8B5A,
   cartoon frogs, a line of glowing cream stepping stones #F5E6B8 under the mud, sky #9AA3A0. The
   pilgrim knee-deep; a big friendly man in a green shirt #4E8F5B reaching down a huge hand.
8. **III. The Wrong Hill.** Bright hills #8DBF6A, sky #A9D3E8, a smooth sunny side road to a pretty
   village beneath a gigantic leaning mountain #5E4B5C with slow orange flickers #FF8A3D and falling
   pebbles; the true bumpy path glows gold the other way. A fancy gentleman in a purple coat #6A3D7A
   and tall hat pointing at the village, his hat blowing off.
9. **IV. The Wicket Gate.** High cream wall #C9BBA0, small wooden gate #8A5A3B spilling warm light
   #FFF2C2, big round cover rocks, a gloomy castle #3E3548 on a ridge with little dark cartoon arrows
   arcing down and red landing lines, an elderly gatekeeper with a ring of keys pulling the pilgrim in.
   Cartoon peril only.

## C. UI and icon concepts (reference for hand-built SVG, not for shipping)

10. **UI kit sheet (1:1).** On dark plum #2B2235: cream panels #FFF4DC with tan rims #E6C891 and solid
    offset shadows #C9A066; gold buttons #F2B33D with a deep-gold #C4861B bottom edge in normal,
    hover-lifted and pressed-squashed states; a round speech bubble with a tail; a pill toast with a
    round gold icon badge; satchel, pause and detour icons; five tabs in a row. Placeholder bars, no
    real text.
11. **Icon row (16:9).** Brass hope lantern five times, flame growing from ember to blaze with a golden
    halo #FFD27A; glowing scroll with gold ribbon; golden key; red heart with cream outline; short
    sword; round shield with a gold rising sun over a path; plumed helmet #B8C2CC / #4F7FA6.
12. **Hero turnaround (16:9).** The pilgrim three times, front view, cream background: burdened (as in
    A1); free in white #F4F1E8 with gold trim #E8C25A and a glowing forehead dot; in armour with helmet,
    plume, emblem shield and short sword.

## D. Trailer motion (Veo, 8 s each)

13. Slow push-in over the title backdrop (A5) as the far light brightens and motes drift up.
14. Follow-cam behind the burdened pilgrim on the golden path at dusk; the sack bounces with each step.
15. The Cross: ropes snap one by one, the sack tumbles down a green hill into an open stone tomb, then
    the pilgrim straightens up and leaps for joy with sparkles. Dawn light.
16. Wicket gate opening, warm light spilling out, slow dolly forward.

## Notes

- Nothing from the 2019 film or any adaptation (GDD 1.4). Use Bunyan's place names only.
- Skin tones spread evenly across heroes and villains: #F1C7A3 #E0A57A #C68A5E #9C6644 #6E4A33.
- Four earlier gpt-image renders of A1, B6, B9 and C10 were submitted to Higgsfield before generation
  there was stopped; if they finished they sit in that account's library.
