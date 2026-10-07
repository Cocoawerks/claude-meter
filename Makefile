UUID := claude-meter@cbruno.linux
DEST := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
FILES := metadata.json extension.js prefs.js stylesheet.css icons schemas claude-meter-settings

.PHONY: all schemas install enable uninstall zip clean

all: schemas

schemas: schemas/gschemas.compiled

schemas/gschemas.compiled: schemas/*.gschema.xml
	glib-compile-schemas --strict schemas/

install: schemas
	mkdir -p $(DEST)
	cp -r $(FILES) $(DEST)/

enable: install
	gnome-extensions enable $(UUID)

uninstall:
	-gnome-extensions disable $(UUID)
	rm -rf $(DEST)

zip: schemas
	rm -f $(UUID).zip
	zip -r $(UUID).zip $(FILES)

clean:
	rm -f schemas/gschemas.compiled $(UUID).zip
