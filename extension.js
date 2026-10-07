/* Claude Code Meter — top bar usage meter for GNOME Shell 42 (Pop!_OS 22.04) */
'use strict';

const { GObject, St, Gio, GLib, Soup, Clutter } = imports.gi;
const ByteArray = imports.byteArray;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const USAGE_PAGE = 'https://claude.ai/settings/usage';
const CREDENTIALS = GLib.build_filenamev([GLib.get_home_dir(), '.claude', '.credentials.json']);
const BAR_WIDTH = 280;
const PANEL_BAR_WIDTH = 40;

function formatReset(iso) {
    if (!iso)
        return '';
    const when = GLib.DateTime.new_from_iso8601(iso, null);
    if (!when)
        return '';
    const secs = Math.max(0, when.to_unix() - GLib.get_real_time() / 1e6);
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const rel = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
    const local = when.to_local();
    const abs = d > 0 ? local.format('%a %-l:%M %p') : local.format('%-l:%M %p');
    return `Resets in ${rel} · ${abs}`;
}

// Actor sizes are in physical pixels, so the trough and the fill must both be
// scaled; scaling only the fill overflows the trough on HiDPI displays.
function setFill(fill, width, pct, warn, crit) {
    const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    const trough = Math.round(width * scale);
    fill.get_parent().width = trough;
    fill.width = Math.round(trough * pct / 100);
    fill.remove_style_class_name('warning');
    fill.remove_style_class_name('critical');
    if (pct >= crit)
        fill.add_style_class_name('critical');
    else if (pct >= warn)
        fill.add_style_class_name('warning');
}

function panelBar() {
    const trough = new St.Widget({ style_class: 'claude-meter-panel-trough', width: PANEL_BAR_WIDTH });
    trough.fill = new St.Widget({ style_class: 'claude-meter-panel-fill', width: 0 });
    trough.add_child(trough.fill);
    return trough;
}

const UsageRow = GObject.registerClass(
class UsageRow extends PopupMenu.PopupBaseMenuItem {
    _init(title) {
        super._init({ reactive: false, can_focus: false });
        // Non-clickable items are drawn greyed out by default; these rows are
        // informational, so render them with normal menu text instead.
        this.remove_style_class_name('popup-inactive-menu-item');

        const box = new St.BoxLayout({ vertical: true, style_class: 'claude-meter-row', x_expand: true });
        this.add_child(box);

        const header = new St.BoxLayout({ x_expand: true });
        header.add_child(new St.Label({ text: title, style_class: 'claude-meter-title', x_expand: true }));
        this._percent = new St.Label({ text: '–', style_class: 'claude-meter-percent' });
        header.add_child(this._percent);
        box.add_child(header);

        this._trough = new St.Widget({ style_class: 'claude-meter-trough', width: BAR_WIDTH });
        this._fill = new St.Widget({ style_class: 'claude-meter-fill', width: 0 });
        this._trough.add_child(this._fill);
        box.add_child(this._trough);

        // Secondary text: theme colour at reduced opacity, so it reads on light and dark menus.
        this._sub = new St.Label({ text: '', style_class: 'claude-meter-sub', opacity: 230 });
        box.add_child(this._sub);
    }

    update(window, warn, crit) {
        if (!window || window.utilization === undefined || window.utilization === null) {
            this._percent.text = '–';
            this._fill.width = 0;
            this._sub.text = 'No data';
            return;
        }
        const pct = Math.max(0, Math.min(100, window.utilization));
        this._percent.text = `${Math.round(pct)}%`;
        setFill(this._fill, BAR_WIDTH, pct, warn, crit);
        this._sub.text = formatReset(window.resets_at);
    }
});

const ClaudeMeter = GObject.registerClass(
class ClaudeMeter extends PanelMenu.Button {
    _init(settings) {
        super._init(0.0, 'Claude Code Meter');
        this._settings = settings;
        this._data = null;
        this._timer = 0;
        this._session = new Soup.Session({ timeout: 20, user_agent: 'claude-code-meter/1' });

        const box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        box.add_child(new St.Icon({
            gicon: Gio.icon_new_for_string(Me.dir.get_child('icons').get_child('claude-meter-symbolic.svg').get_path()),
            style_class: 'system-status-icon',
        }));
        // Two stacked mini bars: session on top, week below.
        this._bars = new St.BoxLayout({ vertical: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'claude-meter-panel-bars' });
        this._sessionBar = panelBar();
        this._weeklyBar = panelBar();
        this._bars.add_child(this._sessionBar);
        this._bars.add_child(this._weeklyBar);
        box.add_child(this._bars);
        // Only used for loading/error states.
        this._label = new St.Label({ text: '…', y_align: Clutter.ActorAlign.CENTER, style_class: 'claude-meter-panel-label' });
        box.add_child(this._label);
        this.add_child(box);

        this._sessionRow = new UsageRow('Current session (5h)');
        this._weeklyRow = new UsageRow('Current week');
        this.menu.addMenuItem(this._sessionRow);
        this.menu.addMenuItem(this._weeklyRow);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._status = new PopupMenu.PopupMenuItem('', { reactive: false, can_focus: false });
        this._status.label.add_style_class_name('claude-meter-status');
        this.menu.addMenuItem(this._status);

        this.menu.addAction('Refresh now', () => this._refresh());
        this.menu.addAction('Open usage page', () => Gio.AppInfo.launch_default_for_uri(USAGE_PAGE, null));
        this.menu.addAction('Settings', () => {
            const tool = Me.dir.get_child('claude-meter-settings').get_path();
            try {
                GLib.spawn_async(null, ['python3', tool], null, GLib.SpawnFlags.SEARCH_PATH, null);
            } catch (e) {
                ExtensionUtils.openPrefs();
            }
        });

        // Recompute "resets in" text whenever the menu is opened.
        this.menu.connect('open-state-changed', (_m, open) => {
            if (open)
                this._render();
        });

        this._settingsIds = [
            settings.connect('changed::refresh-interval', () => this._schedule()),
            settings.connect('changed::panel-mode', () => this._render()),
            settings.connect('changed::warn-threshold', () => this._render()),
            settings.connect('changed::critical-threshold', () => this._render()),
        ];

        this._refresh();
        this._schedule();
    }

    _schedule() {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            this._settings.get_int('refresh-interval'), () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            });
    }

    _readToken() {
        try {
            const [ok, bytes] = GLib.file_get_contents(CREDENTIALS);
            if (!ok)
                return null;
            const oauth = JSON.parse(ByteArray.toString(bytes)).claudeAiOauth;
            return oauth && oauth.accessToken ? oauth.accessToken : null;
        } catch (e) {
            return null;
        }
    }

    _refresh() {
        const token = this._readToken();
        if (!token) {
            this._setError('Not signed in — run `claude` and log in');
            return;
        }
        const msg = Soup.Message.new('GET', USAGE_URL);
        msg.request_headers.append('Authorization', `Bearer ${token}`);
        msg.request_headers.append('anthropic-beta', 'oauth-2025-04-20');
        msg.request_headers.append('Accept', 'application/json');
        this._session.queue_message(msg, (_s, m) => {
            if (m.status_code === 401) {
                this._setError('Login expired — open Claude Code to refresh it');
                return;
            }
            if (m.status_code !== 200) {
                this._setError(`Usage request failed (HTTP ${m.status_code})`);
                return;
            }
            try {
                this._data = JSON.parse(m.response_body.data);
                this._error = null;
                this._updated = GLib.DateTime.new_now_local();
            } catch (e) {
                this._setError('Could not parse usage response');
                return;
            }
            this._render();
        });
    }

    _setError(text) {
        this._error = text;
        this._render();
    }

    _render() {
        const warn = this._settings.get_int('warn-threshold');
        const crit = this._settings.get_int('critical-threshold');
        const d = this._data || {};
        this._sessionRow.update(d.five_hour, warn, crit);
        this._weeklyRow.update(d.seven_day, warn, crit);

        const util = w => (w && w.utilization !== null && w.utilization !== undefined ? Math.max(0, Math.min(100, w.utilization)) : null);
        const mode = this._settings.get_string('panel-mode');
        const s = util(d.five_hour), w = util(d.seven_day);
        setFill(this._sessionBar.fill, PANEL_BAR_WIDTH, s ?? 0, warn, crit);
        setFill(this._weeklyBar.fill, PANEL_BAR_WIDTH, w ?? 0, warn, crit);
        const haveData = !!this._data;
        this._bars.visible = haveData && mode !== 'icon';
        this._sessionBar.visible = mode === 'both' || mode === 'session';
        this._weeklyBar.visible = mode === 'both' || mode === 'weekly';
        this._label.text = haveData ? '' : this._error ? '!' : '…';
        this._label.visible = !haveData;

        if (this._error)
            this._status.label.text = this._error;
        else if (this._updated)
            this._status.label.text = `Updated ${this._updated.format('%-l:%M %p')}`;
        else
            this._status.label.text = 'Loading…';
    }

    destroy() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
        }
        this._settingsIds.forEach(id => this._settings.disconnect(id));
        this._session.abort();
        super.destroy();
    }
});

class Extension {
    enable() {
        this._settings = ExtensionUtils.getSettings();
        this._indicator = new ClaudeMeter(this._settings);
        Main.panel.addToStatusArea(Me.metadata.uuid, this._indicator, 0, 'right');
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
        this._settings = null;
    }
}

function init() {
    return new Extension();
}
