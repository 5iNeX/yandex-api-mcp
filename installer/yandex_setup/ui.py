"""Small Russian terminal widgets with confirmation defaulting to No."""

import curses
import locale
import shutil
import textwrap

from .common import fail as error


def _run_tui(draw):
    try:
        locale.setlocale(locale.LC_ALL, "")
        return curses.wrapper(draw)
    except curses.error:
        error(
            "терминал слишком мал или не поддерживает интерактивный режим; запусти команду в SSH/локальном терминале"
        )


def _line(stdscr, y, x, text, attr=0):
    height, width = stdscr.getmaxyx()
    if 0 <= y < height and x < width:
        try:
            stdscr.addstr(
                y, max(0, x), str(text)[: max(0, width - max(0, x) - 1)], attr
            )
        except curses.error:
            pass


def choose(title, prompt, items, multiple=True, selected=None):
    if not items:
        msg("Нет доступных записей для выбора.")
        return [] if multiple else None
    current = 0
    selected_values = {str(x) for x in (selected or [])}
    selected_indices = {
        i for i, (key, _) in enumerate(items) if str(key) in selected_values
    }
    if not multiple and selected_indices:
        current = min(selected_indices)
    top = 0

    def draw(stdscr):
        nonlocal current, top, selected_indices
        curses.curs_set(0)
        stdscr.keypad(True)
        while True:
            stdscr.erase()
            h, w = stdscr.getmaxyx()
            _line(stdscr, 0, 0, title, curses.A_BOLD)
            _line(stdscr, 2, 0, prompt)
            visible = max(1, h - 7)
            top = min(top, current)
            if current >= top + visible:
                top = current - visible + 1
            for offset, i in enumerate(range(top, min(len(items), top + visible))):
                key, label = items[i]
                prefix = (
                    ("[x] " if i in selected_indices else "[ ] ") if multiple else "  "
                )
                attr = curses.A_REVERSE if i == current else curses.A_NORMAL
                _line(stdscr, 4 + offset, 0, prefix + str(label), attr)
            if top > 0:
                _line(stdscr, 3, w - 12, "↑ ещё выше")
            if top + visible < len(items):
                _line(stdscr, h - 3, w - 13, "↓ ещё ниже")
            hint = (
                "↑/↓ выбрать • Пробел отметить • Enter готово • Esc/q назад"
                if multiple
                else "↑/↓ выбрать • Enter подтвердить • Esc/q назад"
            )
            _line(stdscr, h - 1, 0, hint, curses.A_DIM)
            stdscr.refresh()
            key = stdscr.getch()
            if key in (27, ord("q"), ord("Q")):
                return [] if multiple else None
            if key in (curses.KEY_UP, ord("k")):
                current = (current - 1) % len(items)
            elif key in (curses.KEY_DOWN, ord("j")):
                current = (current + 1) % len(items)
            elif multiple and key == ord(" "):
                if current in selected_indices:
                    selected_indices.remove(current)
                else:
                    selected_indices.add(current)
            elif key in (10, 13, curses.KEY_ENTER):
                if multiple:
                    return [str(items[i][0]) for i in sorted(selected_indices)]
                return str(items[current][0])
            elif key == curses.KEY_NPAGE:
                current = min(len(items) - 1, current + visible)
            elif key == curses.KEY_PPAGE:
                current = max(0, current - visible)

    return _run_tui(draw)


def msg(text, title="Yandex MCP"):
    lines = []
    width = max(20, min(100, shutil.get_terminal_size((100, 28)).columns - 4))
    for para in str(text).splitlines() or [""]:
        lines.extend(
            textwrap.wrap(
                para, width=width, replace_whitespace=False, drop_whitespace=True
            )
            or [""]
        )
    offset = 0

    def draw(stdscr):
        nonlocal offset
        curses.curs_set(0)
        stdscr.keypad(True)
        while True:
            stdscr.erase()
            h, _w = stdscr.getmaxyx()
            visible = max(1, h - 5)
            _line(stdscr, 0, 0, title, curses.A_BOLD)
            for i, line in enumerate(lines[offset : offset + visible]):
                _line(stdscr, 2 + i, 0, line)
            _line(stdscr, h - 1, 0, "↑/↓ прокрутка • Enter/Esc/q закрыть", curses.A_DIM)
            stdscr.refresh()
            key = stdscr.getch()
            if key in (27, ord("q"), ord("Q"), 10, 13, curses.KEY_ENTER):
                return
            if key in (curses.KEY_DOWN, ord("j")):
                offset = min(max(0, len(lines) - visible), offset + 1)
            elif key in (curses.KEY_UP, ord("k")):
                offset = max(0, offset - 1)
            elif key == curses.KEY_NPAGE:
                offset = min(max(0, len(lines) - visible), offset + visible)
            elif key == curses.KEY_PPAGE:
                offset = max(0, offset - visible)

    _run_tui(draw)


def confirm(text, title="Подтверждение"):
    lines = []
    width = max(20, min(90, shutil.get_terminal_size((100, 28)).columns - 4))
    for para in str(text).splitlines() or [""]:
        lines.extend(
            textwrap.wrap(
                para, width=width, replace_whitespace=False, drop_whitespace=True
            )
            or [""]
        )
    offset = 0
    answer = False

    def draw(stdscr):
        nonlocal offset, answer
        curses.curs_set(0)
        stdscr.keypad(True)
        while True:
            stdscr.erase()
            h, w = stdscr.getmaxyx()
            visible = max(1, h - 6)
            _line(stdscr, 0, 0, title, curses.A_BOLD)
            for i, line in enumerate(lines[offset : offset + visible]):
                _line(stdscr, 2 + i, 0, line)
            _line(
                stdscr,
                h - 1,
                0,
                "←/→ выбрать • Enter подтвердить • Esc/q = Нет",
                curses.A_DIM,
            )
            y = h - 3
            left = max(0, w // 2 - 12)
            right = max(0, w // 2 + 2)
            _line(
                stdscr, y, left, " Да ", curses.A_REVERSE if answer else curses.A_NORMAL
            )
            _line(
                stdscr,
                y,
                right,
                " Нет ",
                curses.A_REVERSE if not answer else curses.A_NORMAL,
            )
            stdscr.refresh()
            key = stdscr.getch()
            if key in (27, ord("q"), ord("Q"), ord("n"), ord("N")):
                return False
            if key in (ord("y"), ord("Y")):
                return True
            if key in (curses.KEY_LEFT, curses.KEY_RIGHT, ord(" ")):
                answer = not answer
            elif key in (10, 13, curses.KEY_ENTER):
                return answer
            elif key in (curses.KEY_DOWN, ord("j")):
                offset = min(max(0, len(lines) - visible), offset + 1)
            elif key in (curses.KEY_UP, ord("k")):
                offset = max(0, offset - 1)
            elif key == curses.KEY_NPAGE:
                offset = min(max(0, len(lines) - visible), offset + visible)
            elif key == curses.KEY_PPAGE:
                offset = max(0, offset - visible)

    return _run_tui(draw)
