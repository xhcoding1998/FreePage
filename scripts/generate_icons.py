from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "icons"
BLUE = (37, 99, 235, 255)
NAVY = (22, 59, 114, 255)
PALE_BLUE = (239, 246, 255, 255)
MID_BLUE = (96, 165, 250, 255)
SOFT_BLUE = (147, 197, 253, 255)
BORDER_BLUE = (191, 219, 254, 255)
WHITE = (255, 255, 255, 255)


def render_icon(size: int) -> None:
    canvas_size = max(512, size * 8)
    scale = canvas_size / 128
    image = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    def box(values: tuple[float, float, float, float]) -> tuple[int, int, int, int]:
        return tuple(round(value * scale) for value in values)

    def points(values: list[tuple[float, float]]) -> list[tuple[int, int]]:
        return [(round(x * scale), round(y * scale)) for x, y in values]

    draw.rounded_rectangle(box((6, 6, 122, 122)), radius=round(27 * scale), fill=PALE_BLUE, outline=BORDER_BLUE, width=round(4 * scale))
    draw.rounded_rectangle(box((17, 27, 111, 105)), radius=round(10 * scale), fill=WHITE)

    # Browser chrome: rounded at the top, squared at the lower divider.
    draw.rounded_rectangle(box((17, 27, 111, 59)), radius=round(10 * scale), fill=NAVY)
    draw.rectangle(box((17, 48, 111, 59)), fill=NAVY)
    for x, opacity in ((31, 255), (43, 219), (55, 184)):
        color = (255, 255, 255, opacity)
        draw.ellipse(box((x - 3.5, 39, x + 3.5, 46)), fill=color)

    # Folded page corner.
    draw.polygon(points([(87, 27), (111, 51), (97, 51), (87, 41)]), fill=MID_BLUE)

    # Compact motion cue, kept deliberately bold for the 16 px asset.
    draw.line(points([(34, 77), (56, 77)]), fill=SOFT_BLUE, width=round(5 * scale))
    draw.line(points([(39, 87), (52, 87)]), fill=SOFT_BLUE, width=round(5 * scale))

    # Pointer is outlined so it remains distinct from both the page and fold.
    cursor = points([(61, 65), (68, 99), (76, 88), (88, 103), (96, 97), (84, 82), (97, 77)])
    draw.polygon(cursor, fill=BLUE, outline=WHITE, width=round(3 * scale))

    image.resize((size, size), Image.Resampling.LANCZOS).save(OUTPUT / f"icon{size}.png")


if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for icon_size in (16, 32, 48, 128):
        render_icon(icon_size)
