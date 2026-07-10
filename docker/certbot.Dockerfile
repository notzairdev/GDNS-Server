# syntax=docker/dockerfile:1

FROM certbot/dns-cloudflare:v5.6.0

RUN apk upgrade --no-cache libcrypto3 libssl3 openssl \
    && python -m pip install --no-cache-dir --upgrade \
        cryptography==49.0.0 \
        pyOpenSSL==26.3.0 \
        urllib3==2.7.0 \
    && python -m pip uninstall --yes uv \
    && python -m pip check
