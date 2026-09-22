# To Know Server Agent Linux user service

The Linux x64 Server Agent package installs the runtime and stable launcher with:

```sh
./install.sh
```

This default path does not install or enable a service. The stable launcher is:
`~/.local/bin/toknow-agent`.

To install and start the packaged systemd **user** service, use the explicit
default-root option:

```sh
./install.sh --user-service
```

This copies the packaged unit to
`${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/toknow-agent.service`, runs
`systemctl --user daemon-reload`, and runs
`systemctl --user enable --now toknow-agent.service`. The option rejects a
custom `--prefix` or `TO_KNOW_INSTALL_ROOT`; it never writes to
`/etc/systemd/system`, invokes `sudo`, or enables linger.

Useful lifecycle commands:

```sh
systemctl --user status toknow-agent.service
systemctl --user start toknow-agent.service
systemctl --user stop toknow-agent.service
systemctl --user restart toknow-agent.service
journalctl --user -u toknow-agent.service
```

For rollback, run `systemd/remove-user-service.sh` from the extracted package.
It only removes a unit marked as managed by the To Know installer and first
disables it with `systemctl --user disable --now`.

Enabling the user service makes it start when the user manager starts. To keep
it running after SSH logout and start it after reboot before the first login,
the operator must separately enable linger for the current user:

```sh
loginctl show-user "$USER" -p Linger
loginctl enable-linger "$USER"
```

The installer deliberately does not perform that host-session policy change.

Service journal output must remain privacy-safe. It must not contain
credentials, `Authorization`, `ownerId`, CID values, `CODEX_HOME`, prompts, or
replies. Diagnostics should use profile IDs, lifecycle stages, safe error codes,
and bounded restart counters only.
