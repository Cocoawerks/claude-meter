/* Claude Code Meter — preferences (GTK 4, follows the Pop GTK theme) */
'use strict';

const { Gtk, Gio } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;

function init() {}

function row(title, subtitle, control) {
    const box = new Gtk.Box({ spacing: 12, margin_top: 10, margin_bottom: 10, margin_start: 12, margin_end: 12 });
    const text = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, hexpand: true, valign: Gtk.Align.CENTER });
    text.append(new Gtk.Label({ label: title, xalign: 0 }));
    if (subtitle) {
        const sub = new Gtk.Label({ label: subtitle, xalign: 0, wrap: true });
        sub.add_css_class('dim-label');
        text.append(sub);
    }
    box.append(text);
    control.valign = Gtk.Align.CENTER;
    box.append(control);
    return new Gtk.ListBoxRow({ child: box, activatable: false });
}

function spin(settings, key, min, max, step) {
    const s = Gtk.SpinButton.new_with_range(min, max, step);
    settings.bind(key, s, 'value', Gio.SettingsBindFlags.DEFAULT);
    return s;
}

function buildPrefsWidget() {
    const settings = ExtensionUtils.getSettings();

    const page = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL, spacing: 18,
        margin_top: 24, margin_bottom: 24, margin_start: 24, margin_end: 24,
    });

    const heading = (t) => {
        const l = new Gtk.Label({ label: `<b>${t}</b>`, use_markup: true, xalign: 0 });
        return l;
    };

    // Display
    page.append(heading('Top bar'));
    const display = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE });
    display.add_css_class('frame');
    const modes = [['both', 'Session and week bars'], ['session', 'Session bar only'], ['weekly', 'Week bar only'], ['icon', 'Icon only']];
    const combo = new Gtk.ComboBoxText();
    modes.forEach(([id, label]) => combo.append(id, label));
    settings.bind('panel-mode', combo, 'active-id', Gio.SettingsBindFlags.DEFAULT);
    display.append(row('Show in top bar', 'What appears next to the icon', combo));
    page.append(display);

    // Refresh
    page.append(heading('Updates'));
    const updates = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE });
    updates.add_css_class('frame');
    updates.append(row('Refresh interval', 'Seconds between usage checks (60–3600)', spin(settings, 'refresh-interval', 60, 3600, 30)));
    page.append(updates);

    // Thresholds
    page.append(heading('Colors'));
    const colors = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE });
    colors.add_css_class('frame');
    colors.append(row('Warning at', 'Meter turns amber at this percent', spin(settings, 'warn-threshold', 1, 100, 5)));
    colors.append(row('Critical at', 'Meter turns red at this percent', spin(settings, 'critical-threshold', 1, 100, 5)));
    page.append(colors);

    const note = new Gtk.Label({
        label: 'Usage is read with your Claude Code login (~/.claude/.credentials.json). Nothing is stored or sent anywhere except Anthropic.',
        wrap: true, xalign: 0,
    });
    note.add_css_class('dim-label');
    page.append(note);

    return page;
}
