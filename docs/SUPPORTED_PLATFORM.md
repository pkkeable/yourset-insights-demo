# Supported development platform

This slice supports only macOS 26.5.2 on ARM, Node 26.0.0, Docker Engine 29.7.2 (aarch64), and Supabase CLI 2.117.0. Dependencies remain pinned. This is a local synthetic development boundary, not a published installation procedure.

Windows executable resolution exists in the development shim runner, but was tested only against a mocked filesystem. It is simulated, unverified on Windows, and unsupported. Linux is also unsupported for this slice. No Windows code was removed or changed.

The existing development-only shim covers the fixed local product identity `yourset-insights`. It must be replaced before Phase 2 clean-clone rehearsal; declarative Compose with explicit loopback mappings remains the leading candidate. Hosted Auth-schema privileges remain an unresolved carried risk. No hosted resources are required or touched by the local slice.

## Automated local browser and remaining Phase 2 requirement

The local runner now uses Playwright 1.63.0 and its pinned official Noble Docker image to automate Chromium, without the desktop in-app browser or a machine-specific Chrome installation. The browser runs as Linux ARM inside Docker; this does not add Linux-host or Windows-host support. See `dev/local/README.md` for setup and isolation boundaries.

Native macOS headless launch remains blocked in the desktop sandbox. C5 still requires demonstrated integration tests in a disposable CI environment. A locally automated browser does not establish CI support: the service launcher is still macOS-specific and still uses the development-only shim. Replace that launcher and prove the full suite, teardown and clean-clone installation in the selected CI environment before the Phase 2 gate can pass. The historical in-app-browser proof remains valid local evidence only.
