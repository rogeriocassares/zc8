ARG  BUILDER_IMAGE=golang:1.25.5-alpine3.23
############################
# STEP 1 build executable binary
############################
FROM ${BUILDER_IMAGE} AS builder

# Install git + SSL ca certificates.
# Git is required for fetching the dependencies.
# Ca-certificates is required to call HTTPS endpoints.
RUN apk update && apk add --no-cache git ca-certificates tzdata gcc musl-dev && update-ca-certificates

# Create appuser
ENV USER=appuser
ENV UID=10001

# See https://stackoverflow.com/a/55757473/12429735
RUN adduser \
  --disabled-password \
  --gecos "" \
  --home "/nonexistent" \
  --shell "/sbin/nologin" \
  --no-create-home \
  --uid "${UID}" \
  "${USER}"

WORKDIR $GOPATH/src/github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/
COPY . .

# Fetch dependencies.
# RUN go get -v
RUN go mod tidy

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /go/bin/grpc-parser ./cmd

############################
# STEP 2 build a small image
############################
FROM scratch

# Import from builder.
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /etc/passwd /etc/passwd
COPY --from=builder /etc/group /etc/group

# Copy our static executable
COPY --from=builder /go/bin/grpc-parser /go/bin/grpc-parser

# Use an unprivileged user.
USER appuser:appuser

# Run the grpc-parser binary.
ENTRYPOINT ["/go/bin/grpc-parser"]