# Chaîne de compilation pour la branche `alphanet` de rippled (gcc 15 = version testée par XRPLF).
FROM gcc:15

ARG RUST_VERSION=1.97.1

RUN apt-get update \
    && apt-get install -y --no-install-recommends cmake ninja-build python3-venv ccache \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/conan && /opt/conan/bin/pip install --no-cache-dir "conan>=2.17,<3"

# Rust installé en lecture seule dans l'image ; les composants exigés par rust-toolchain.toml sont pré-installés.
ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo
RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain ${RUST_VERSION} \
    && /opt/cargo/bin/rustup component add rustfmt clippy rust-analyzer llvm-tools-preview rust-src \
    && chmod -R a+rX /opt/rustup /opt/cargo

ENV PATH=/opt/conan/bin:/opt/cargo/bin:${PATH}
