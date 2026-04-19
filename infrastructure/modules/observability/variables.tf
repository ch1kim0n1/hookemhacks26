variable "name" {
  description = "Logical name (alerts topic and alarms prefix with this)."
  type        = string
  default     = "clawguard-obs"
}

variable "alert_emails" {
  description = "Email subscribers for the alerts topic. SNS will send a confirmation email."
  type        = list(string)
  default     = []
}

variable "sign_tx_log_group" {
  description = "sign-tx Lambda log group (empty to skip sign-failure metric)."
  type        = string
  default     = ""
}

variable "detect_log_group" {
  description = "detect Lambda log group (empty to skip detect-error metric)."
  type        = string
  default     = ""
}

variable "sign_tx_function_name" {
  description = "sign-tx Lambda function name (for Lambda-native throttle metrics)."
  type        = string
  default     = ""
}

variable "metrics_namespace" {
  description = "CloudWatch custom-metrics namespace for the filters."
  type        = string
  default     = "ClawGuard/API"
}

variable "sign_failure_threshold" {
  description = "SignFailures/min above this value triggers the alarm."
  type        = number
  default     = 1
}

variable "detect_error_threshold" {
  description = "DetectErrors/min above this value triggers the alarm (for 2 consecutive minutes)."
  type        = number
  default     = 3
}

variable "tags" {
  description = "Additional tags."
  type        = map(string)
  default     = {}
}
