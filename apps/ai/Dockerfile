FROM archlinux:latest

RUN pacman -Sy --noconfirm llama-cpp ggml-vulkan curl bash && \
    pacman -Scc --noconfirm

WORKDIR /app

RUN mkdir -p /models

# Build-time model baking: Model is fetched and packaged during docker build,
# ensuring the runtime image is 100% offline, self-contained, and air-gapped ready.
ARG MODEL_URL="https://huggingface.co/bartowski/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf"
RUN curl -L -o /models/gemma-3-1b-it-Q4_K_M.gguf "${MODEL_URL}"

ENV PORT=8080
ENV HOST=0.0.0.0
ENV MODEL_PATH=/models/gemma-3-1b-it-Q4_K_M.gguf
ENV N_GPU_LAYERS=99
ENV CTX_SIZE=4096
ENV THREADS=8

EXPOSE 8080

CMD ["/bin/bash", "-c", "/usr/bin/llama-server -m ${MODEL_PATH} --host ${HOST} --port ${PORT} -c ${CTX_SIZE} -t ${THREADS} -ngl ${N_GPU_LAYERS} --flash-attn auto"]
