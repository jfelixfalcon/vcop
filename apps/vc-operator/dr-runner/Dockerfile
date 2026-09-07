FROM registry.k8s.io/etcd:3.6.8-0 AS etcd-bin

FROM alpine:3.20
RUN apk add --no-cache bash curl tzdata coreutils ca-certificates

COPY --from=etcd-bin /usr/local/bin/etcdctl /usr/local/bin/etcdctl
COPY --from=etcd-bin /usr/local/bin/etcdutl /usr/local/bin/etcdutl

COPY backup.sh /scripts/backup.sh
COPY restore.sh /scripts/restore.sh
RUN chmod +x /scripts/*.sh

WORKDIR /backup
CMD ["/scripts/backup.sh"]
