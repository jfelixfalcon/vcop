{{/*
Expand the name of the chart.
*/}}
{{- define "vcop.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
*/}}
{{- define "vcop.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "vcop.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "vcop.labels" -}}
helm.sh/chart: {{ include "vcop.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: vcop
{{- end }}

{{/*
Operator selector labels
*/}}
{{- define "vcop.operator.selectorLabels" -}}
app.kubernetes.io/name: {{ include "vcop.name" . }}-operator
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: controller
{{- end }}

{{/*
UI selector labels
*/}}
{{- define "vcop.ui.selectorLabels" -}}
app.kubernetes.io/name: {{ include "vcop.name" . }}-ui
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: dashboard
{{- end }}

{{/*
Operator ServiceAccount name
*/}}
{{- define "vcop.operator.serviceAccountName" -}}
{{- if .Values.operator.serviceAccount.create }}
{{- default (printf "%s-operator" (include "vcop.fullname" .)) .Values.operator.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.operator.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
UI ServiceAccount name
*/}}
{{- define "vcop.ui.serviceAccountName" -}}
{{- if .Values.ui.serviceAccount.create }}
{{- default (printf "%s-ui" (include "vcop.fullname" .)) .Values.ui.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.ui.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Metrics DB selector labels
*/}}
{{- define "vcop.metricsDb.selectorLabels" -}}
app.kubernetes.io/name: {{ include "vcop.name" . }}-metrics-db
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: metrics-db
{{- end }}

{{/*
AI Assistant selector labels
*/}}
{{- define "vcop.ai.selectorLabels" -}}
app.kubernetes.io/name: {{ include "vcop.name" . }}-ai
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: inference-engine
{{- end }}

{{/*
OCI Registry selector labels
*/}}
{{- define "vcop.registry.selectorLabels" -}}
app.kubernetes.io/name: {{ include "vcop.name" . }}-registry
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: oci-registry
{{- end }}

