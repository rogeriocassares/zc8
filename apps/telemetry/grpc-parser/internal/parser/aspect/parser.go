package aspect

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/util"
)

// am19_sl

type AM19Message struct {
	X_01_0 float64 `json:"01_0"`
	X_01_1 float64 `json:"01_1"`
	X_01_2 float64 `json:"01_2"`
	X_01_3 float64 `json:"01_3"`
	X_01_4 float64 `json:"01_4"`
	X_01_5 float64 `json:"01_5"`
	X_01_6 float64 `json:"01_6"`
	X_01_7 float64 `json:"01_7"`
	X_02   float64 `json:"02"`
	X_03_0 float64 `json:"03_0"`
	X_03_1 float64 `json:"03_1"`
	X_04   uint64  `json:"04"`
	X_05_0 float64 `json:"05_0"`
	X_05_1 float64 `json:"05_1"`
	X_05_2 float64 `json:"05_2"`
	X_06   uint64  `json:"06"`
	X_07   uint64  `json:"07"`
	X_08   uint64  `json:"08"`
	X_09   uint64  `json:"09"`
	X_0A_0 float64 `json:"0A_0"`
	X_0A_1 float64 `json:"0A_1"`
	X_0B   uint64  `json:"0B"`
	X_0C   float64 `json:"0C"`
	X_0D_0 uint64  `json:"0D_0"`
	X_0D_1 uint64  `json:"0D_1"`
	X_0D_2 uint64  `json:"0D_2"`
	X_0D_3 uint64  `json:"0D_3"`
	X_0E_0 float64 `json:"0E_0"`
	X_0E_1 float64 `json:"0E_1"`
	X_10   uint64  `json:"10"`
	X_11   float64 `json:"11"`
	X_12   uint64  `json:"12"`
	X_13   uint64  `json:"13"`
}

type SmartLight struct {
	Temperature     float64 `json:"temperature"`
	Humidity        float64 `json:"humidity"`
	Luminosity      float64 `json:"lux"`
	MovementCounter uint64  `json:"movementCounter"`
	BatteryVoltage  float64 `json:"battery"`
	BoardVoltage    float64 `json:"boardVoltage"`
}

type MilkFat struct {
	Temperature  float64 `json:"temperature"`
	InfraRed     uint64  `json:"infraRed"`
	Capacitive   uint64  `json:"capacitive"`
	MilkFat      float64 `json:"milkFat"`
	BoardVoltage float64 `json:"boardVoltage"`
}

type GPS struct {
	Latitude     float64 `json:"latitude"`
	Longitude    float64 `json:"longitude"`
	BoardVoltage float64 `json:"boardVoltage"`
}

type VibrationAverage struct {
	Temperature       float64 `json:"temperature"`
	Humidity          float64 `json:"humidity"`
	VibrationAverageX float64 `json:"lux"`
	VibrationAverageY float64 `json:"movement"`
	VibrationAverageZ float64 `json:"battery"`
	BoardVoltage      float64 `json:"boardVoltage"`
}

type WaterTankLevel struct {
	Distance     uint64  `json:"distance"`
	BoardVoltage float64 `json:"boardVoltage"`
}

type GaugePressure struct {
	InletPressure  float64 `json:"outletPressure"`
	OutletPressure float64 `json:"inletPressure"`
	BoardVoltage   float64 `json:"boardVoltage"`
}

type Hydrometer struct {
	LitreCounter uint64  `json:"litreCounter"`
	BoardVoltage float64 `json:"boardVoltage"`
}

type EnergyMeter struct {
	ForwardEnergy float64 `json:"forwardEnergy"`
	ReverseEnergy float64 `json:"reverseEnergy"`
	BoardVoltage  float64 `json:"boardVoltage"`
}

type Sprinkler struct {
	Solenoid1    bool    `json:"solenoid1"`
	Solenoid2    bool    `json:"solenoid2"`
	Solenoid3    bool    `json:"solenoid3"`
	Counter      uint64  `json:"counter"`
	BoardVoltage float64 `json:"boardVoltage"`
}

type SoilMoisture3DepthLevels struct {
	SoilMoistureDepthLevel1 float64 `json:"soilMoistureDepthLevel1"`
	SoilMoistureDepthLevel2 float64 `json:"soilMoistureDepthLevel2"`
	SoilMoistureDepthLevel3 float64 `json:"soilMoistureDepthLevel3"`
	BoardVoltage            float64 `json:"boardVoltage"`
}

type Temperature8Point struct {
	Temperature1 float64 `json:"temperature1"`
	Temperature2 float64 `json:"temperature2"`
	Temperature3 float64 `json:"temperature3"`
	Temperature4 float64 `json:"temperature4"`
	Temperature5 float64 `json:"temperature5"`
	Temperature6 float64 `json:"temperature6"`
	Temperature7 float64 `json:"temperature7"`
	Temperature8 float64 `json:"temperature8"`
	BoardVoltage float64 `json:"boardVoltage"`
}

func ParseAspectUplink(payload []byte, model string) (*util.ParsedData, error) {
	dp := &util.ParsedData{
		Name:   "",
		Fields: make(map[string]any),
		Tags:   make(map[string]string),
	}

	var am19 AM19Message
	d := ParseAM19(payload)
	json.Unmarshal([]byte(d), &am19)

	switch model {
	case "SmartLight":
		var smartLight SmartLight
		smartLight.Temperature = am19.X_01_0
		smartLight.Humidity = am19.X_02
		smartLight.MovementCounter = am19.X_0B
		smartLight.Luminosity = util.RoundFloat((math.Pow(float64(am19.X_0D_0), -3.746) * 50000000000000), 1)
		smartLight.BatteryVoltage = float64(am19.X_0D_1) * 4.3 / 1000
		smartLight.BoardVoltage = am19.X_0C

		dp.Fields["temperature"] = util.FieldsValue{Key: "temperature", Value: smartLight.Temperature}
		dp.Fields["humidity"] = util.FieldsValue{Key: "humidity", Value: smartLight.Humidity}
		dp.Fields["movementCounter"] = util.FieldsValue{Key: "movementCounter", Value: smartLight.MovementCounter}
		dp.Fields["luminosity"] = util.FieldsValue{Key: "luminosity", Value: smartLight.Luminosity}
		dp.Fields["batteryVoltage"] = util.FieldsValue{Key: "batteryVoltage", Value: smartLight.BatteryVoltage}
		dp.Fields["boardVoltage"] = util.FieldsValue{Key: "boardVoltage", Value: smartLight.BoardVoltage}
		dp.Fields["data"] = util.FieldsValue{Key: "data", Value: payload}
	}

	return dp, nil
}

func ParseAM19(bytes []byte) string {
	var am19 AM19Message

	len := len(bytes)
	_0d := 0
	_0e := 0
	_03 := 0
	_01 := 0

PL: // Parse Loop
	for i := 0; i < len; i++ {
		switch bytes[i] {
		// case 0x00:
		// fmt.Println("00")

		case 0x01:
			switch _01 {
			case 0:
				v := uint64(bytes[i+1]) << 8
				v |= uint64(bytes[i+2])
				f := float64(v) / 10
				i = i + 2
				_01 = _01 + 1
				am19.X_01_0 = f

			case 1:
				v := uint64(bytes[i+1]) << 8
				v |= uint64(bytes[i+2])
				f := float64(v) / 10
				i = i + 2
				_01 = _01 + 1
				am19.X_01_1 = f

			case 2:
				v := uint64(bytes[i+1]) << 8
				v |= uint64(bytes[i+2])
				f := float64(v) / 10
				i = i + 2
				_01 = _01 + 1
				am19.X_01_2 = f

			case 3:
				v := uint64(bytes[i+1]) << 8
				v |= uint64(bytes[i+2])
				f := float64(v) / 10
				i = i + 2
				_01 = _01 + 1
				am19.X_01_3 = f

			case 4:
				v := uint64(bytes[i+1]) << 8
				v |= uint64(bytes[i+2])
				f := float64(v) / 10
				i = i + 2
				_01 = _01 + 1
				am19.X_01_4 = f

			case 5:
				v := uint64(bytes[i+1]) << 8
				v |= uint64(bytes[i+2])
				f := float64(v) / 10
				i = i + 2
				_01 = _01 + 1
				am19.X_01_5 = f

			case 6:
				v := uint64(bytes[i+1]) << 8
				v |= uint64(bytes[i+2])
				f := float64(v) / 10
				i = i + 2
				_01 = _01 + 1
				am19.X_01_6 = f

			case 7:
				v := uint64(bytes[i+1]) << 8
				v |= uint64(bytes[i+2])
				f := float64(v) / 10
				i = i + 2
				_01 = _01 + 1
				am19.X_01_7 = f
			}

		case 0x02:
			v := uint64(bytes[i+1]) << 8
			v |= uint64(bytes[i+2])
			f := float64(v) / 10
			i = i + 2
			am19.X_02 = f

		case 0x03:
			switch _03 {
			case 0:
				v := uint64(bytes[i+3]) << 8
				v |= uint64(bytes[i+4])
				f := float64(v)
				am19.X_03_0 = f
				i = i + 2
				_03 = _03 + 1
			case 1:
				v := uint64(bytes[i+3]) << 8
				v |= uint64(bytes[i+4])
				f := float64(v)
				am19.X_03_1 = f
				i = i + 2
				_03 = _03 + 1
			}

			// case 0x03:
			//   var press = {};
			//   press.v = (bytes[index++]<<8) | bytes[index++];
			//   press.n = "press";
			//   press.u = "hPa";
			//   decoded.modules.push(press);
			//   break;

			// 	// case 0x04:
			// 	//   var corrente = {};
			// 	//   corrente.v = (bytes[index++]<<8) | bytes[index++];
			// 	//   corrente.n = "corrente";
			// 	//   corrente.u = "A";
			// 	//   decoded.modules.push(corrente);
			// 	//   break;

		case 0x05:
			v := uint64(bytes[i+1]) << 8
			v |= uint64(bytes[i+2])
			f := float64(v) / 10
			am19.X_05_0 = f
			v = uint64(bytes[i+3]) << 8
			v |= uint64(bytes[i+4])
			f = float64(v) / 10
			am19.X_05_1 = f
			v = uint64(bytes[i+5]) << 8
			v |= uint64(bytes[i+6])
			f = float64(v) / 10
			am19.X_05_2 = f
			i = i + 6

			// 	// case 0x06:
			// 	//   var accx = {};
			// 	//   accx.v = (bytes[index++]<<8) | bytes[index++];
			// 	//   accx.n = "AceleromeroX";
			// 	//   accx.u = "g";
			// 	//   decoded.modules.push(accx);
			// 	//   var accy = {};
			// 	//   accy.v = (bytes[index++]<<8) | bytes[index++];
			// 	//   accy.n = "AceleromeroY";
			// 	//   accy.u = "g";
			// 	//   decoded.modules.push(accy);
			// 	//   var accz = {};
			// 	//   accz.v = (bytes[index++]<<8) | bytes[index++];
			// 	//   accz.n = "AceleromeroZ";
			// 	//   accz.u = "g";
			// 	//   decoded.modules.push(accz);
			// 	//   break;

			// 	// case 0x07:
			// 	//   var magx = {};
			// 	//   magx.v = (bytes[index++]<<8) | bytes[index++];
			// 	//   magx.n = "MagnetometroX";
			// 	//   magx.u = "mGauss";
			// 	//   decoded.modules.push(magx);
			// 	//   var magy = {};
			// 	//   magy.v = (bytes[index++]<<8) | bytes[index++];
			// 	//   magy.n = "MagnetometroY";
			// 	//   magy.u = "mGauss";
			// 	//   decoded.modules.push(magy);
			// 	//   var magz = {};
			// 	//   magz.v = (bytes[index++]<<8) | bytes[index++];
			// 	//   magz.n = "MagnetometroZ";
			// 	//   magz.u = "mGauss";
			// 	//   decoded.modules.push(magz);
			// 	//   break;

			// 	// case 0x08:
			// 	//     //data.rtc = data.remainingData.slice(0,6);
			// 	//     bytes[index++];bytes[index++];
			// 	//     bytes[index++];
			// 	//     bytes[index++];
			// 	//     break;

			// 	// case 0x09:
			// 	//     //data.date = data.remainingData.slice(0,8);
			// 	//     bytes[index++];bytes[index++];
			// 	//     bytes[index++];bytes[index++];

			// 	//     break;

		case 0x0A:
			var f float64
			v := uint64(bytes[i+1])
			a := uint64(bytes[i+2]) << 16
			a |= uint64(bytes[i+3]) << 8
			a |= uint64(bytes[i+4])
			b := float64(a) / 1000000

			if v > 127 {
				f = -((255 - float64(v)) + 1) - b //complement of 2
			} else {
				f = float64(v) + b
			}
			am19.X_0A_0 = f

			v = uint64(bytes[i+5])
			a = uint64(bytes[i+6]) << 16
			a |= uint64(bytes[i+7]) << 8
			a |= uint64(bytes[i+8])
			b = float64(a) / 1000000

			if v > 127 {
				f = -((255 - float64(v)) + 1) - b //complement of 2
			} else {
				f = float64(v) + b
			}
			am19.X_0A_1 = f
			i = i + 8

		case 0x0B:
			v := uint64(bytes[i+1]) << 16
			v |= uint64(bytes[i+2]) << 8
			v |= uint64(bytes[i+3])
			am19.X_0B = v
			i = i + 3

		case 0x0C:
			v := uint64(bytes[i+1]) << 8
			v |= uint64(bytes[i+2])
			f := float64(v) / 1000
			am19.X_0C = f
			i = i + 2

		case 0x0D:
			switch _0d {
			case 0:
				v := uint64(bytes[i+1]) << 8
				v |= uint64(bytes[i+2])
				am19.X_0D_0 = v
				i = i + 2
				_0d = _0d + 1

			case 1:
				v := uint64(bytes[i+1]) << 8
				v |= uint64(bytes[i+2])
				am19.X_0D_1 = v
				i = i + 2
				_0d = _0d + 1

			case 2:
				v := uint64(bytes[i+1]) << 8
				v |= uint64(bytes[i+2])
				am19.X_0D_2 = v
				i = i + 2
				_0d = _0d + 1

			case 3:
				v := uint64(bytes[i+1]) << 8
				v |= uint64(bytes[i+2])
				am19.X_0D_3 = v
				i = i + 2
				_0d = _0d + 1
			}

		case 0x0E:
			switch _0e {
			case 0:
				v := uint64(bytes[i+1]) << 24
				v |= uint64(bytes[i+2]) << 16
				v |= uint64(bytes[i+3]) << 8
				v |= uint64(bytes[i+4])
				f := float64(v) * (150 / 5) / 2000
				am19.X_0E_0 = f
				i = i + 4
				_0e = _0e + 1

			case 1:
				v := uint64(bytes[i+1]) << 24
				v |= uint64(bytes[i+2]) << 16
				v |= uint64(bytes[i+3]) << 8
				v |= uint64(bytes[i+4])
				f := float64(v) * (150 / 5) / 2000
				am19.X_0E_1 = f
				i = i + 4
				_0e = _0e + 1
			}
			// 	// case 0x0F:
			// 	//     //data.rfid = data.remainingData.slice(0,16);
			// 	//     bytes[index++];bytes[index++];
			// 	//     bytes[index++];bytes[index++];
			// 	//     bytes[index++];bytes[index++];
			// 	//     bytes[index++];bytes[index++];
			// 	//     break;

		case 0x10:
			v := uint64(bytes[i+1]) << 8
			v |= uint64(bytes[i+2])
			am19.X_10 = v
			i = i + 2

		case 0x11:
			v := uint64(bytes[i+1]) << 8
			v |= uint64(bytes[i+2])
			f := float64(v) / 100
			am19.X_11 = f
			i = i + 2

			// 	// case 0x12:
			// 	//     //data.color = data.remainingData.slice(0,4);
			// 	//     bytes[index++];bytes[index++];
			// 	//     break;

		case 0x13:
			v := uint64(bytes[i+1]) << 8
			v |= uint64(bytes[i+2])
			am19.X_13 = v
			i = i + 2

		// 	// case 0x14:
		// 	//     //data.heartbeat = data.remainingData.slice(0,4);
		// 	//     bytes[index++];bytes[index++];
		// 	//     break;

		// 	// case 0x15:
		// 	//     //data.oxigenVolume = data.remainingData.slice(0,4);
		// 	//     bytes[index++];bytes[index++];
		// 	//     break;

		// case 0x16:
		// 	// NEED TO DEBUG
		// 	for j := 0; j < 17; j++ {
		// 		sb.WriteString("data_fft_")
		// 		sb.WriteString(strconv.FormatUint(uint64(j), 10))
		// 		sb.WriteString("=")
		// 		v := uint64(bytes[i+1])
		// 		sb.WriteString(strconv.FormatUint(v, 10))
		// 		sb.WriteString(",")
		// 	}
		// 	i = i + 17

		default:
			// fmt.Print("Data not parsed by decode.LoRaImt imtIotProtocolParser()\n")
			break PL
		}
	}

	p, err := json.Marshal(am19)
	if err != nil {
		fmt.Println(err)
		return "AM19Message data parsed wrongly"
	}
	return string(p[:])
}

func parseLnsMeasurement(measurement string, data []byte, port uint64, deviceId string) string {
	// measurements format
	var sb strings.Builder
	var am19 AM19Message
	d := ParseAM19(data)
	json.Unmarshal([]byte(d), &am19)

	switch measurement {
	case "SmartLight":
		var smartLight SmartLight
		smartLight.Temperature = am19.X_01_0
		smartLight.Humidity = am19.X_02
		smartLight.MovementCounter = am19.X_0B
		smartLight.Luminosity = util.RoundFloat((math.Pow(float64(am19.X_0D_0), -3.746) * 50000000000000), 1)
		smartLight.BatteryVoltage = float64(am19.X_0D_1) * 4.3 / 1000
		smartLight.BoardVoltage = am19.X_0C

		sb.WriteString(`,temperature=`)
		sb.WriteString(strconv.FormatFloat(smartLight.Temperature, 'f', -1, 64))
		sb.WriteString(`,humidity=`)
		sb.WriteString(strconv.FormatFloat(smartLight.Humidity, 'f', -1, 64))
		sb.WriteString(`,movementCounter=`)
		sb.WriteString(strconv.FormatUint(uint64(smartLight.MovementCounter), 10))
		sb.WriteString(`,luminosity=`)
		sb.WriteString(strconv.FormatFloat(smartLight.Luminosity, 'f', -1, 64))
		sb.WriteString(`,batteryVoltage=`)
		sb.WriteString(strconv.FormatFloat(smartLight.BatteryVoltage, 'f', -1, 64))
		sb.WriteString(`,boardVoltage=`)
		sb.WriteString(strconv.FormatFloat(smartLight.BoardVoltage, 'f', -1, 64))

	case "WaterTankLevel":
		var waterTankLevel WaterTankLevel
		waterTankLevel.Distance = am19.X_13
		waterTankLevel.BoardVoltage = am19.X_0C

		sb.WriteString(`,distance=`)
		sb.WriteString(strconv.FormatUint(uint64(waterTankLevel.Distance), 10))
		sb.WriteString(`,boardVoltage=`)
		sb.WriteString(strconv.FormatFloat(waterTankLevel.BoardVoltage, 'f', -1, 64))

	case "GaugePressure":
		var gaugePressure GaugePressure
		gaugePressure.InletPressure = float64(am19.X_0D_0)
		gaugePressure.OutletPressure = float64(am19.X_0D_1)
		gaugePressure.BoardVoltage = am19.X_0C

		sb.WriteString(`,inletPressure=`)
		sb.WriteString(strconv.FormatFloat(gaugePressure.InletPressure, 'f', -1, 64))
		sb.WriteString(`,outletPressure=`)
		sb.WriteString(strconv.FormatFloat(gaugePressure.OutletPressure, 'f', -1, 64))
		sb.WriteString(`,boardVoltage=`)
		sb.WriteString(strconv.FormatFloat(gaugePressure.BoardVoltage, 'f', -1, 64))

	case "Hydrometer":
		var hydrometer Hydrometer
		hydrometer.LitreCounter = am19.X_0B
		hydrometer.BoardVoltage = am19.X_0C

		sb.WriteString(`,litreCounter=`)
		sb.WriteString(strconv.FormatUint(uint64(hydrometer.LitreCounter)*1000, 10))
		sb.WriteString(`,boardVoltage=`)
		sb.WriteString(strconv.FormatFloat(hydrometer.BoardVoltage, 'f', -1, 64))

	case "EnergyMeter":
		var energyMeter EnergyMeter
		energyMeter.ForwardEnergy = am19.X_0E_0
		energyMeter.ReverseEnergy = am19.X_0E_1
		energyMeter.BoardVoltage = am19.X_0C

		sb.WriteString(`,forwardEnergy=`)
		sb.WriteString(strconv.FormatFloat(energyMeter.ForwardEnergy, 'f', -1, 64))
		sb.WriteString(`,reverseEnergy=`)
		sb.WriteString(strconv.FormatFloat(energyMeter.ReverseEnergy, 'f', -1, 64))
		sb.WriteString(`,boardVoltage=`)
		sb.WriteString(strconv.FormatFloat(energyMeter.BoardVoltage, 'f', -1, 64))

	case "Sprinkler":
		var sprinkler Sprinkler
		solenoid1 := am19.X_0D_0
		solenoid2 := am19.X_0D_1
		solenoid3 := am19.X_0D_2

		if solenoid1 > 1500 {
			sprinkler.Solenoid1 = true
		} else {
			sprinkler.Solenoid1 = false
		}

		if solenoid2 > 1500 {
			sprinkler.Solenoid2 = true
		} else {
			sprinkler.Solenoid2 = false
		}

		if solenoid3 > 1500 {
			sprinkler.Solenoid3 = true
		} else {
			sprinkler.Solenoid3 = false
		}

		sprinkler.Counter = am19.X_0B
		sprinkler.BoardVoltage = am19.X_0C

		sb.WriteString(`,solenoid1=`)
		sb.WriteString(strconv.FormatBool(sprinkler.Solenoid1))
		sb.WriteString(`,solenoid2=`)
		sb.WriteString(strconv.FormatBool(sprinkler.Solenoid2))
		sb.WriteString(`,solenoid3=`)
		sb.WriteString(strconv.FormatBool(sprinkler.Solenoid3))
		sb.WriteString(`,counter=`)
		sb.WriteString(strconv.FormatUint(uint64(sprinkler.Counter), 10))
		sb.WriteString(`,boardVoltage=`)
		sb.WriteString(strconv.FormatFloat(sprinkler.BoardVoltage, 'f', -1, 64))

	case "SoilMoisture3DepthLevels":
		var soilMoisture3DepthLevels SoilMoisture3DepthLevels
		var a, x, y, f float64
		if deviceId == "0004a30b00e9be97" {
			// 10
			y = -0.8
			a = 15000
			x = float64(am19.X_0D_0)

			f = util.RoundFloat(a*math.Pow(x, y), 0)
			f = util.RoundFloat(f/1.25, 0)

			if f > 100 {
				f = 100
			}
			if f < 0 {
				f = 0
			}
			soilMoisture3DepthLevels.SoilMoistureDepthLevel1 = f

			// 30
			y = -0.8
			a = 15000
			x = float64(am19.X_0D_1)

			f = util.RoundFloat(a*math.Pow(x, y), 0)
			f = util.RoundFloat(f/1.4, 0)

			if f > 100 {
				f = 100
			}
			if f < 0 {
				f = 0
			}
			soilMoisture3DepthLevels.SoilMoistureDepthLevel2 = f

			// 70
			y = -0.8
			a = 15000
			x = float64(am19.X_0D_2)

			f = util.RoundFloat(a*math.Pow(x, y), 0)
			f = util.RoundFloat(f/1.9, 0)

			if f > 100 {
				f = 100
			}
			if f < 0 {
				f = 0
			}
			soilMoisture3DepthLevels.SoilMoistureDepthLevel3 = f
		}

		if deviceId == "0004a30b00e93245" {
			// 10
			y = -0.516
			a = 795
			x = float64(am19.X_0D_0)

			f = util.RoundFloat(a*math.Pow(x, y), 0)
			if f > 100 {
				f = 100
			}
			if f < 0 {
				f = 0
			}
			soilMoisture3DepthLevels.SoilMoistureDepthLevel1 = f

			// 30
			y = -0.512
			a = 856
			x = float64(am19.X_0D_1)

			f = util.RoundFloat(a*math.Pow(x, y), 0)
			if f > 100 {
				f = 100
			}
			if f < 0 {
				f = 0
			}
			soilMoisture3DepthLevels.SoilMoistureDepthLevel2 = f

			// 70
			y = -0.553
			a = 1011
			x = float64(am19.X_0D_2)

			f = util.RoundFloat(a*math.Pow(x, y), 0)
			if f > 100 {
				f = 100
			}
			if f < 0 {
				f = 0
			}
			soilMoisture3DepthLevels.SoilMoistureDepthLevel3 = f
		}

		if deviceId == "0004a30b00e9d69d" {
			// 10
			y = -0.516
			a = 795
			x = float64(am19.X_0D_0)

			f = util.RoundFloat(a*math.Pow(x, y), 0)
			if f > 100 {
				f = 100
			}
			if f < 0 {
				f = 0
			}
			soilMoisture3DepthLevels.SoilMoistureDepthLevel1 = f

			// 30
			y = -0.512
			a = 856
			x = float64(am19.X_0D_1)

			f = util.RoundFloat(a*math.Pow(x, y), 0)
			if f > 100 {
				f = 100
			}
			if f < 0 {
				f = 0
			}
			soilMoisture3DepthLevels.SoilMoistureDepthLevel2 = f

			// 70
			y = -0.553
			a = 1011
			x = float64(am19.X_0D_2)

			f = util.RoundFloat(a*math.Pow(x, y), 0)
			if f > 100 {
				f = 100
			}
			if f < 0 {
				f = 0
			}
			soilMoisture3DepthLevels.SoilMoistureDepthLevel3 = f
		}
		// soilMoisture3DepthLevels.SoilMoistureDepthLevel1 = am19.X_0D_2
		// soilMoisture3DepthLevels.SoilMoistureDepthLevel2 = am19.X_0D_1
		// soilMoisture3DepthLevels.SoilMoistureDepthLevel3 = am19.X_0D_0
		// soilMoisture3DepthLevels.BoardVoltage = am19.X_0C

		sb.WriteString(`,soilMoistureDepthLevel1=`)
		sb.WriteString(strconv.FormatUint(uint64(soilMoisture3DepthLevels.SoilMoistureDepthLevel1), 10))
		sb.WriteString(`,soilMoistureDepthLevel2=`)
		sb.WriteString(strconv.FormatUint(uint64(soilMoisture3DepthLevels.SoilMoistureDepthLevel2), 10))
		sb.WriteString(`,soilMoistureDepthLevel3=`)
		sb.WriteString(strconv.FormatUint(uint64(soilMoisture3DepthLevels.SoilMoistureDepthLevel3), 10))
		sb.WriteString(`,boardVoltage=`)
		sb.WriteString(strconv.FormatFloat(soilMoisture3DepthLevels.BoardVoltage, 'f', -1, 64))

	case "MilkFat":
		var milkFat MilkFat
		milkFat.Temperature = am19.X_01_0
		milkFat.InfraRed = am19.X_0D_0
		milkFat.Capacitive = am19.X_0D_1
		if deviceId == "0004a30b00e9d7c9" {
			milkFat.MilkFat = (float64(milkFat.InfraRed-100) * 0.035)
		}
		if deviceId == "0004a30b00e9856d" {
			milkFat.MilkFat = (float64(milkFat.InfraRed-180) * 0.0292)
		}
		if deviceId == "0004a30b00e94844" {
			milkFat.MilkFat = (float64(milkFat.InfraRed-190) * 0.0159)
		}
		if milkFat.MilkFat > 10 {
			milkFat.MilkFat = -1
		} else {
			util.RoundFloat(milkFat.MilkFat, 1)
		}
		milkFat.BoardVoltage = am19.X_0C

		sb.WriteString(`,temperature=`)
		sb.WriteString(strconv.FormatFloat(milkFat.Temperature, 'f', -1, 64))
		sb.WriteString(`,infraRed=`)
		sb.WriteString(strconv.FormatUint(uint64(milkFat.InfraRed), 10))
		sb.WriteString(`,capacitive=`)
		sb.WriteString(strconv.FormatUint(uint64(milkFat.Capacitive), 10))
		sb.WriteString(`,milkFat=`)
		sb.WriteString(strconv.FormatFloat(float64(milkFat.MilkFat), 'f', -1, 64))
		sb.WriteString(`,boardVoltage=`)
		sb.WriteString(strconv.FormatFloat(milkFat.BoardVoltage, 'f', -1, 64))

	case "GPS":
		var gps GPS
		gps.Latitude = am19.X_0A_0
		gps.Longitude = am19.X_0A_1
		gps.BoardVoltage = am19.X_0C

		sb.WriteString(`,latitude=`)
		sb.WriteString(strconv.FormatFloat(gps.Latitude, 'f', -1, 64))
		sb.WriteString(`,longitude=`)
		sb.WriteString(strconv.FormatFloat(gps.Longitude, 'f', -1, 64))
		sb.WriteString(`,boardVoltage=`)
		sb.WriteString(strconv.FormatFloat(gps.BoardVoltage, 'f', -1, 64))

	case "Temperature8Point":
		var temperature8Point Temperature8Point
		auxTemperature1 := uint64(am19.X_01_2 * 10)
		auxTemperature2 := uint64(am19.X_01_3 * 10)
		auxTemperature3 := uint64(am19.X_01_4 * 10)
		auxTemperature4 := uint64(am19.X_01_5 * 10)
		auxTemperature5 := uint64(am19.X_01_6 * 10)
		auxTemperature6 := uint64(am19.X_01_7 * 10)
		auxTemperature7 := uint64(am19.X_01_1 * 10)
		auxTemperature8 := uint64(am19.X_01_0 * 10)

		if auxTemperature1&0x8000 > 0 {
			auxTemperature1 = auxTemperature1 - 0x10000
		}
		temperature8Point.Temperature1 = float64(auxTemperature1+3) / 10

		if auxTemperature2&0x8000 > 0 {
			auxTemperature2 = auxTemperature2 - 0x10000
		}
		temperature8Point.Temperature2 = float64(auxTemperature2+7) / 10

		if auxTemperature3&0x8000 > 0 {
			auxTemperature3 = auxTemperature3 - 0x10000
		}
		temperature8Point.Temperature3 = float64(auxTemperature3+3) / 10

		if auxTemperature4&0x8000 > 0 {
			auxTemperature4 = auxTemperature4 - 0x10000
		}
		temperature8Point.Temperature4 = float64(auxTemperature4+4) / 10

		if auxTemperature5&0x8000 > 0 {
			auxTemperature5 = auxTemperature5 - 0x10000
		}
		temperature8Point.Temperature5 = float64(auxTemperature5+6) / 10

		if auxTemperature6&0x8000 > 0 {
			auxTemperature6 = auxTemperature6 - 0x10000
		}
		temperature8Point.Temperature6 = float64(auxTemperature6+6) / 10

		if auxTemperature7&0x8000 > 0 {
			auxTemperature7 = auxTemperature7 - 0x10000
		}
		temperature8Point.Temperature7 = float64(auxTemperature7+7) / 10

		if auxTemperature8&0x8000 > 0 {
			auxTemperature8 = auxTemperature8 - 0x10000
		}
		temperature8Point.Temperature8 = float64(auxTemperature8-18) / 10

		temperature8Point.BoardVoltage = am19.X_0C

		sb.WriteString(`,temperature1=`)
		sb.WriteString(strconv.FormatFloat(temperature8Point.Temperature1, 'f', -1, 64))
		sb.WriteString(`,temperature2=`)
		sb.WriteString(strconv.FormatFloat(temperature8Point.Temperature2, 'f', -1, 64))
		sb.WriteString(`,temperature3=`)
		sb.WriteString(strconv.FormatFloat(temperature8Point.Temperature3, 'f', -1, 64))
		sb.WriteString(`,temperature4=`)
		sb.WriteString(strconv.FormatFloat(temperature8Point.Temperature4, 'f', -1, 64))
		sb.WriteString(`,temperature5=`)
		sb.WriteString(strconv.FormatFloat(temperature8Point.Temperature5, 'f', -1, 64))
		sb.WriteString(`,temperature6=`)
		sb.WriteString(strconv.FormatFloat(temperature8Point.Temperature6, 'f', -1, 64))
		sb.WriteString(`,temperature7=`)
		sb.WriteString(strconv.FormatFloat(temperature8Point.Temperature7, 'f', -1, 64))
		sb.WriteString(`,temperature8=`)
		sb.WriteString(strconv.FormatFloat(temperature8Point.Temperature8, 'f', -1, 64))
		sb.WriteString(`,boardVoltage=`)
		sb.WriteString(strconv.FormatFloat(temperature8Point.BoardVoltage, 'f', -1, 64))

	case "VibrationAverage":
		var vibrationAverage VibrationAverage
		vibrationAverage.Temperature = am19.X_01_0
		vibrationAverage.Humidity = am19.X_02
		vibrationAverage.VibrationAverageX = am19.X_05_0
		vibrationAverage.VibrationAverageY = am19.X_05_1
		vibrationAverage.VibrationAverageZ = am19.X_05_2
		vibrationAverage.BoardVoltage = am19.X_0C

		sb.WriteString(`,temperature=`)
		sb.WriteString(strconv.FormatFloat(vibrationAverage.Temperature, 'f', -1, 64))
		sb.WriteString(`,humidity=`)
		sb.WriteString(strconv.FormatFloat(vibrationAverage.Humidity, 'f', -1, 64))
		sb.WriteString(`,vibrationAverageX=`)
		sb.WriteString(strconv.FormatFloat(vibrationAverage.VibrationAverageX, 'f', -1, 64))
		sb.WriteString(`,vibrationAverageY=`)
		sb.WriteString(strconv.FormatFloat(vibrationAverage.VibrationAverageY, 'f', -1, 64))
		sb.WriteString(`,vibrationAverageZ=`)
		sb.WriteString(strconv.FormatFloat(vibrationAverage.VibrationAverageZ, 'f', -1, 64))
		sb.WriteString(`,boardVoltage=`)
		sb.WriteString(strconv.FormatFloat(vibrationAverage.BoardVoltage, 'f', -1, 64))
	default:
	}
	return sb.String()
}
