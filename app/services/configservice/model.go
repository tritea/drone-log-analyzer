package configservice

type SettingsResponse struct {
	Settings map[string]any `json:"settings"`
	Path     string         `json:"path"`
}

type FlightMetricsResponse struct {
	Metrics map[string]any `json:"metrics"`
	Path    string         `json:"path"`
}

type FieldCurve struct {
	Type        string  `json:"type"`
	Field       string  `json:"field"`
	Visible     bool    `json:"visible"`
	Color       string  `json:"color,omitempty"`
	Scale       float64 `json:"scale"`
	Offset      float64 `json:"offset"`
	ScaleInput  string  `json:"scaleInput,omitempty"`
	OffsetInput string  `json:"offsetInput,omitempty"`
}

type FieldEntry struct {
	Name        string       `json:"name"`
	Curves      []FieldCurve `json:"curves"`
	Scale       float64      `json:"scale"`
	Offset      float64      `json:"offset"`
	ScaleInput  string       `json:"scaleInput,omitempty"`
	OffsetInput string       `json:"offsetInput,omitempty"`
	CreatedAt   string       `json:"createdAt,omitempty"`
	UpdatedAt   string       `json:"updatedAt,omitempty"`
}

type FieldEntriesResponse struct {
	Entries    []FieldEntry `json:"templates"`
	Path       string       `json:"path"`
	SavedEntry string       `json:"savedTemplate,omitempty"`
}

type DeleteFieldEntryRequest struct {
	Name string `json:"name"`
}

type CurveStateCurve struct {
	Type                  string  `json:"type"`
	Field                 string  `json:"field"`
	Visible               bool    `json:"visible"`
	Color                 string  `json:"color,omitempty"`
	Scale                 float64 `json:"scale"`
	Offset                float64 `json:"offset"`
	ScaleInput            string  `json:"scaleInput,omitempty"`
	OffsetInput           string  `json:"offsetInput,omitempty"`
	FieldName             string  `json:"templateName,omitempty"`
	FieldGroupScale       float64 `json:"templateGroupScale"`
	FieldGroupOffset      float64 `json:"templateGroupOffset"`
	FieldGroupScaleInput  string  `json:"templateGroupScaleInput,omitempty"`
	FieldGroupOffsetInput string  `json:"templateGroupOffsetInput,omitempty"`
}

type CurveStateRequest struct {
	ActiveCurves []CurveStateCurve `json:"activeCurves"`
}

type CurveStateResponse struct {
	ActiveCurves []CurveStateCurve `json:"activeCurves"`
	UpdatedAt    string            `json:"updatedAt"`
	Path         string            `json:"path"`
}

type CustomModel struct {
	Name      string  `json:"name"`
	File      string  `json:"file"`
	Lon       float64 `json:"lon"`
	Lat       float64 `json:"lat"`
	Alt       float64 `json:"alt"`
	Yaw       float64 `json:"yaw"`
	Pitch     float64 `json:"pitch"`
	Roll      float64 `json:"roll"`
	Scale     float64 `json:"scale"`
	Hidden    bool    `json:"hidden"`
	CreatedAt string  `json:"createdAt,omitempty"`
	UpdatedAt string  `json:"updatedAt,omitempty"`
}

type CustomModelsResponse struct {
	Models     []CustomModel `json:"models"`
	Path       string        `json:"path"`
	SavedModel string        `json:"savedModel,omitempty"`
}

type DeleteCustomModelRequest struct {
	Name string `json:"name"`
}

type ModelGroupTile struct {
	Row  int     `json:"row"`
	Col  int     `json:"col"`
	File string  `json:"file"`
	Yaw  float64 `json:"yaw"`
}

type ModelGroup struct {
	Name      string           `json:"name"`
	Lon       float64          `json:"lon"`
	Lat       float64          `json:"lat"`
	Alt       float64          `json:"alt"`
	Spacing   float64          `json:"spacing"`
	Rows      int              `json:"rows"`
	Cols      int              `json:"cols"`
	Yaw       float64          `json:"yaw"`
	Scale     float64          `json:"scale"`
	Hidden    bool             `json:"hidden"`
	Tiles     []ModelGroupTile `json:"tiles"`
	CreatedAt string           `json:"createdAt,omitempty"`
	UpdatedAt string           `json:"updatedAt,omitempty"`
}

type ModelGroupsResponse struct {
	Groups     []ModelGroup `json:"groups"`
	Path       string       `json:"path"`
	SavedGroup string       `json:"savedGroup,omitempty"`
}

type DeleteModelGroupRequest struct {
	Name string `json:"name"`
}

// Tileset describes an imported 3D Tiles surveying dataset. 3D Tiles datasets
// are self-georeferenced (ECEF/WGS84); a height offset, manual lon/lat anchor,
// scale, and three-axis rotation are exposed for fine-tuning when the display
// is wrong.
type Tileset struct {
	Name         string  `json:"name"`
	Dir          string  `json:"dir"`                   // local tileset root dir (in-place reference or copied)
	Url          string  `json:"url,omitempty"`         // optional remote tileset.json URL (Cesium Ion / external)
	HeightOffset float64 `json:"heightOffset"`          // height offset in metres (terrain fit)
	Scale        float64 `json:"scale"`                 // uniform scale (1 = unchanged; only applies under manual position)
	Lon          float64 `json:"lon"`                   // manual geo longitude in degrees; Lon=0 & Lat=0 = use tileset's native georef
	Lat          float64 `json:"lat"`                   // manual geo latitude in degrees (paired with Lon)
	Yaw          float64 `json:"yaw"`                   // three-axis rotation: yaw in degrees (about local Up)
	Pitch        float64 `json:"pitch"`                 // three-axis rotation: pitch in degrees
	Roll         float64 `json:"roll"`                  // three-axis rotation: roll in degrees
	Hidden       bool    `json:"hidden"`
	CreatedAt    string  `json:"createdAt,omitempty"`
	UpdatedAt    string  `json:"updatedAt,omitempty"`
}

type TilesetsResponse struct {
	Tilesets     []Tileset `json:"tilesets"`
	Path         string    `json:"path"`
	SavedTileset string    `json:"savedTileset,omitempty"`
}

type DeleteTilesetRequest struct {
	Name string `json:"name"`
}
