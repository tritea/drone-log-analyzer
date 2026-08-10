package transport

import (
	"drone-log-analyzer/app/services/configservice"
	"drone-log-analyzer/app/services/logservice"
	"drone-log-analyzer/app/services/mapservice"
)

type Services struct {
	Log    logservice.Service
	Map    mapservice.Service
	Config configservice.Service
}
