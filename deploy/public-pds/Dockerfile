FROM node:24.22.1-alpine3.23@sha256:0468540aa58203ff9e40c2aab3907c52644ab818af6176b1c70a026137dc92a2 AS security_runtime
FROM ghcr.io/bluesky-social/pds@sha256:3a8feb3415e319dbcc13372293b7ef1fb05a318a6ff1d55968cf99ba6633c5d4
USER root
RUN rm -rf /usr/local/lib/node_modules/npm
COPY --from=security_runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=security_runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
USER 1000:1000
