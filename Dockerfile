# syntax = docker/dockerfile:1

# Adjust NODE_VERSION as desired
ARG NODE_VERSION=20.11.0
FROM node:${NODE_VERSION}-slim as base

LABEL fly_launch_runtime="Remix"

# Remix app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"
ENV RPC_URL="https://site1.moralis-nodes.com/base/13c515d815804deda6ae8d8ca42c9ab9"
ENV PRIVATE_KEY1="b890d957ccd00d189e7e51173cd5a0cdbf6659f6a30e502d1a978e279fc64e4e"
ENV PRIVATE_KEY2="1974599b11b403a2ec565b224f7473b253e3b4732a9a94de22c73c31d4e0354a"
ENV PRIVATE_KEY3="5e693fdb688dddff8b52eb065e7c9c23836d2d761374f94be972ad294cfbea92"
ENV PRIVATE_KEY4="de9be858da4a475276426320d5e9262ecfc3ba460bfac56360bfa6c4c28b4ee0"
ENV PRIVATE_KEY5="a82afda979d53b4f02012ae2b91b034a458bc58458bfcb02e0ec2ea822935948"
ENV PRIVATE_KEY6="b678926807040d53f0bc1200643ff2897e89a85cc1e141eb989d88d99de1ef51"
ENV PRIVATE_KEY7="c4393ce52f67695911e4ecd4e1077bbabc54eb9e2d0361a00d5255ba540f56b1"
ENV PRIVATE_KEY8="c851693cefec2c0935ff3074ebc0330f97f054766cc7bbded9cceaf3a1f34ee7"
ENV PRIVATE_KEY9="81d57d405f69160421ff3cec701b9e5b4298aadf28f2859c335161f4c262a54c"
ENV PRIVATE_KEY10="dbe3b57094bb57d039548634e94522f4ba26aa1e3dd889e8f31e347d46fafb4d"


# Throw-away build stage to reduce size of final image
FROM base as build

# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install -y build-essential pkg-config python-is-python3

# Install node modules
COPY --link package-lock.json package.json ./
RUN npm ci --include=dev

# Copy application code
COPY --link . .

# Build application
RUN npm run build

# Remove development dependencies
RUN npm prune --omit=dev


# Final stage for app image
FROM base

# Copy built application
COPY --from=build /app /app

# Start the server by default, this can be overwritten at runtime
EXPOSE 3000
CMD [ "npm", "run", "start" ]
