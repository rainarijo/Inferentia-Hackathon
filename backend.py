# backend.py
from flask import Flask, jsonify, request
from flask_cors import CORS
import requests
import random
import time

try:
    import RPi.GPIO as GPIO   # works on Banana Pi / Nano Pi
    HARDWARE = True
except ImportError:
    HARDWARE = False

app = Flask(__name__)
CORS(app)

TOMTOM_KEY = "3K9kSnXBJGDJ0VzpJr82wjoZR5oLKNpW"

# -------------------- SENSOR SETUP --------------------
if HARDWARE:
    TRIG, ECHO = 23, 24
    GPIO.setmode(GPIO.BCM)
    GPIO.setup(TRIG, GPIO.OUT)
    GPIO.setup(ECHO, GPIO.IN)

    def get_distance():
        GPIO.output(TRIG, True)
        time.sleep(0.00001)
        GPIO.output(TRIG, False)

        start, stop = time.time(), time.time()
        while GPIO.input(ECHO) == 0:
            start = time.time()
        while GPIO.input(ECHO) == 1:
            stop = time.time()

        return (stop - start) * 34300 / 2


# -------------------- ROUTES --------------------

@app.route("/tomtom-traffic")
def tomtom_traffic():
    """
    Single-point traffic flow data from TomTom.
    Called by fetchLiveTraffic() in the frontend.
    Query params: lat, lon
    """
    try:
        lat = request.args.get("lat")
        lon = request.args.get("lon")
        if not lat or not lon:
            return jsonify({"error": "lat and lon required"}), 400

        url = (
            f"https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json"
            f"?point={lat},{lon}&key={TOMTOM_KEY}"
        )
        res = requests.get(url, timeout=10)
        res.raise_for_status()
        return jsonify(res.json())

    except requests.exceptions.RequestException as e:
        return jsonify({"error": f"TomTom request failed: {str(e)}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/tomtom-traffic-bbox")
def tomtom_traffic_bbox():
    """
    3×3 grid of TomTom traffic points around a lat/lon.
    Used to build heatmap intensity data.
    Query params: lat, lon
    Note: server.js /getTrafficHeatmap does the same thing — use whichever you prefer.
    """
    try:
        lat = request.args.get("lat")
        lon = request.args.get("lon")
        if not lat or not lon:
            return jsonify({"error": "lat and lon required"}), 400

        lat = float(lat)
        lon = float(lon)
        delta = 0.0015
        points = []

        steps = [-delta, 0, delta]
        for dlat in steps:
            for dlon in steps:
                p_lat, p_lon = lat + dlat, lon + dlon
                url = (
                    f"https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json"
                    f"?point={p_lat},{p_lon}&key={TOMTOM_KEY}"
                )
                try:
                    res = requests.get(url, timeout=8)
                    data = res.json()
                    intensity = 0.5  # default: free flow
                    if "flowSegmentData" in data:
                        free    = data["flowSegmentData"].get("freeFlowSpeed", 50)
                        current = data["flowSegmentData"].get("currentSpeed", free)
                        # ratio > 1 means congestion; clamp between 0.5 and 3.0
                        intensity = min(max(free / current, 0.5), 3.0)
                    points.append({"lat": p_lat, "lon": p_lon, "intensity": intensity})
                except Exception as inner_e:
                    print(f"Point ({p_lat}, {p_lon}) failed: {inner_e}")
                    points.append({"lat": p_lat, "lon": p_lon, "intensity": 0.5})

        return jsonify({"points": points})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/nano-sensor")
def nano_sensor():
    """
    Reads ultrasonic sensor on Nano/Banana Pi to count nearby vehicles.
    Falls back to random simulation if no hardware is present.
    Called by fetchNanoSensor() in the frontend.
    """
    try:
        if HARDWARE:
            dist = get_distance()
            # Object within 20 cm = a car is present
            cars = 1 if dist < 20 else 0
        else:
            cars = random.randint(0, 5)

        return jsonify({
            "traffic_count": cars,
            "source": "hardware" if HARDWARE else "simulated"
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
