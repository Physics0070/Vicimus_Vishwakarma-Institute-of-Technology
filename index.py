"""Vercel entrypoint: exposes the FastAPI app (the dashboard is served by the same app)."""

import ctypes
import glob
import importlib.util
import os
import sys
import tempfile


def _preload_libgomp() -> None:
    """LightGBM's native library needs libgomp.so.1, which Vercel's Python runtime does not ship.

    scikit-learn's manylinux wheel vendors libgomp under a hashed name (and soname). Load a copy
    whose soname is plain "libgomp.so.1" with RTLD_GLOBAL, so the dynamic linker resolves
    lib_lightgbm.so's dependency to it when lightgbm is imported.
    """
    if not sys.platform.startswith("linux"):
        return
    try:
        ctypes.CDLL("libgomp.so.1", mode=ctypes.RTLD_GLOBAL)
        return                                    # system copy present (e.g. Docker image)
    except OSError:
        pass
    spec = importlib.util.find_spec("sklearn")
    if spec is None or spec.origin is None:
        return
    site = os.path.dirname(os.path.dirname(spec.origin))
    vendored = sorted(glob.glob(os.path.join(site, "scikit_learn.libs", "libgomp*.so*")))
    if not vendored:
        return
    src = vendored[0]
    old, new = os.path.basename(src).encode(), b"libgomp.so.1"
    with open(src, "rb") as f:
        elf = f.read()
    # rewrite the soname in place (same length, NUL-padded) so it matches lib_lightgbm.so's DT_NEEDED
    elf = elf.replace(old + b"\0", new + b"\0" * (len(old) - len(new) + 1))
    dst = os.path.join(tempfile.gettempdir(), "libgomp.so.1")
    with open(dst, "wb") as f:
        f.write(elf)
    ctypes.CDLL(dst, mode=ctypes.RTLD_GLOBAL)


_preload_libgomp()

from glucotwin.api import app  # noqa: E402,F401
