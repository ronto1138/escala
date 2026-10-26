# Itinerarios sintéticos (P1)

Especificación, no archivos: los documentos se generan el D3 a partir de esta tabla. Todo es sintético: aerolíneas ZZ, ZY y ZX (país declarado en cada caso), personas inventadas y localizadores con prefijo SYN. Los aeropuertos son reales porque las zonas horarias tienen que serlo. Reglas de calificación en `README.md` §3. Conjunto abierto: 9 de 12.

## IT-EN-2 · en · captura

- **Documento:** Captura de pantalla de un correo de confirmación de una agencia ficticia, con dos pasajeros y la línea 'ZY 4410 · Operated by ZZ'.
- **Usuario del chat:** Sam Rivera
- **Pasajeros en el documento:** Sam Rivera, Jordan Pike (se guarda solo Sam Rivera)
- **Localizador:** SYNP4D

| Operadora | Vendedora | Vuelo | Fecha | Origen | Destino | Salida (local) | Llegada (local) |
|---|---|---|---|---|---|---|---|
| ZZ | ZY | ZY4410 | 2026-12-04 | JFK | CDG | 18:30 | 07:55 (+1) |

- **Trampas:** código compartido: la operadora es ZZ aunque el número sea ZY; dos pasajeros: solo se guarda Sam; Jordan Pike se descarta tras extraer; llegada al día siguiente

## IT-EN-3 · en · PDF

- **Documento:** Recibo de boleto electrónico en PDF de ZX, con una columna 'Local time' y un pie 'Issued 2026-11-02 14:03 UTC'.
- **Usuario del chat:** Morgan Lee
- **Pasajeros en el documento:** Morgan Lee (se guarda solo Morgan Lee)
- **Localizador:** SYNR8W

| Operadora | Vendedora | Vuelo | Fecha | Origen | Destino | Salida (local) | Llegada (local) |
|---|---|---|---|---|---|---|---|
| ZX | = | ZX318 | 2026-11-27 | SFO | YYZ | 23:55 | 07:40 (+1) |

- **Trampas:** vuelo nocturno: llegada +1; hora de emisión en UTC que no es hora de vuelo; zona horaria distinta en origen (PT) y destino (ET)

## IT-EN-4 · en · correo reenviado

- **Documento:** Correo reenviado 'Fwd: Schedule change' de ZZ con el horario anterior tachado y el nuevo; horas con 'CT' y 'ET'.
- **Usuario del chat:** Sam Rivera
- **Pasajeros en el documento:** Sam Rivera (se guarda solo Sam Rivera)
- **Localizador:** SYNA7K

| Operadora | Vendedora | Vuelo | Fecha | Origen | Destino | Salida (local) | Llegada (local) |
|---|---|---|---|---|---|---|---|
| ZZ | = | ZZ1452 | 2026-11-20 | AUS | ORD | 08:05 | 10:30 |
| ZZ | = | ZZ886 | 2026-11-20 | ORD | BOS | 11:40 | 14:55 |

- **Trampas:** cambio de horario: se extrae el nuevo, nunca el tachado; escala en ORD; zonas horarias CT y ET escritas en el texto; el encabezado del reenvío trae otra fecha (la del correo, no la del vuelo)

## IT-ES-2 · es · captura

- **Documento:** Captura de un pase de abordar en la app de ZX: 'Vuelo ZX 2210 · Operado por ZZ', puerta y asiento.
- **Usuario del chat:** Lucía Ortega
- **Pasajeros en el documento:** Lucía Ortega (se guarda solo Lucía Ortega)
- **Localizador:** SYNQ5H

| Operadora | Vendedora | Vuelo | Fecha | Origen | Destino | Salida (local) | Llegada (local) |
|---|---|---|---|---|---|---|---|
| ZZ | ZX | ZX2210 | 2026-11-25 | MEX | IAH | 06:15 | 08:50 |

- **Trampas:** código compartido: operadora ZZ (EE. UU.), cambia la jurisdicción; puerta y asiento no se piden pero pueden guardarse; hora en formato 24 h

## IT-ES-3 · es · PDF

- **Documento:** Itinerario en PDF de una agencia ficticia con dos pasajeros y horas con 'hrs'.
- **Usuario del chat:** Lucía Ortega
- **Pasajeros en el documento:** Lucía Ortega, Martín Salas (se guarda solo Lucía Ortega)
- **Localizador:** SYNM2E

| Operadora | Vendedora | Vuelo | Fecha | Origen | Destino | Salida (local) | Llegada (local) |
|---|---|---|---|---|---|---|---|
| ZX | = | ZX455 | 2026-12-12 | MEX | CUN | 09:00 | 12:15 |

- **Trampas:** dos pasajeros: solo se guarda Lucía; 'hrs' en las horas; CUN está en otra zona horaria que MEX (llegada en hora local de CUN)

## IT-ES-4 · es · correo reenviado

- **Documento:** Correo 'RV: Confirmación de reserva' reenviado por la usuaria; la reserva la hizo otra persona y trae dos pasajeros. Horas en 'hora del centro' y 'PT'.
- **Usuario del chat:** Lucía Ortega
- **Pasajeros en el documento:** Rosa Ortega, Lucía Ortega (se guarda solo Lucía Ortega)
- **Localizador:** SYNK9T

| Operadora | Vendedora | Vuelo | Fecha | Origen | Destino | Salida (local) | Llegada (local) |
|---|---|---|---|---|---|---|---|
| ZX | = | ZX990 | 2026-12-20 | GDL | LAX | 07:30 | 08:55 |
| ZX | = | ZX1404 | 2026-12-20 | LAX | YVR | 11:10 | 13:55 |

- **Trampas:** el primer pasajero del correo no es la usuaria: se identifica a Lucía por la única confirmación, nunca se guarda a Rosa; escala en LAX; hora del centro de México y PT; itinerario que toca EE. UU. y termina en Canadá

## IT-FR-1 · fr · texto libre

- **Documento:** "Vol ZX 870 Montréal–Paris le 22 nov. à 19 h 05, arrivée 8 h 10 le lendemain, puis ZY 7741 pour Nice à 11 h 30. Réservation SYNF3Q."
- **Usuario del chat:** Camille Dufresne
- **Pasajeros en el documento:** Camille Dufresne (se guarda solo Camille Dufresne)
- **Localizador:** SYNF3Q

| Operadora | Vendedora | Vuelo | Fecha | Origen | Destino | Salida (local) | Llegada (local) |
|---|---|---|---|---|---|---|---|
| ZX | = | ZX870 | 2026-11-22 | YUL | CDG | 19:05 | 08:10 (+1) |
| ZY | = | ZY7741 | 2026-11-23 | CDG | NCE | 11:30 | 13:00 |

- **Datos que no vienen (no se preguntan):** llegada del segundo tramo (del feed, rotulada)
- **Trampas:** formato '19 h 05'; llegada +1; escala en CDG; segundo tramo al día siguiente

## IT-FR-2 · fr · captura

- **Documento:** Capture de l'application de ZY : deux passagères et 'Vol ZY 8120 opéré par ZX'.
- **Usuario del chat:** Camille Dufresne
- **Pasajeros en el documento:** Inès Boucher, Camille Dufresne (se guarda solo Camille Dufresne)
- **Localizador:** SYNB6V

| Operadora | Vendedora | Vuelo | Fecha | Origen | Destino | Salida (local) | Llegada (local) |
|---|---|---|---|---|---|---|---|
| ZX | ZY | ZY8120 | 2026-12-02 | CDG | YUL | 13:20 | 15:05 |

- **Trampas:** código compartido: operadora ZX (Canadá): el 261 de la UE aplica por salir de la UE; el APPR por llegar a Canadá; dos pasajeras, la usuaria va en segundo lugar; duración aparente de 1 h 45 min por el cambio de zona horaria (real: unas 7 h 45 min)

## IT-FR-4 · fr · correo reenviado

- **Documento:** Courriel 'TR : Modification d'horaire' de ZY : l'en-tête technique donne l'heure d'envoi en UTC; le corps donne l'ancien et le nouvel horaire en heure locale.
- **Usuario del chat:** Camille Dufresne
- **Pasajeros en el documento:** Camille Dufresne (se guarda solo Camille Dufresne)
- **Localizador:** SYNF3Q

| Operadora | Vendedora | Vuelo | Fecha | Origen | Destino | Salida (local) | Llegada (local) |
|---|---|---|---|---|---|---|---|
| ZY | = | ZY7743 | 2026-11-23 | CDG | NCE | 14:10 | 15:40 |

- **Trampas:** hora UTC del encabezado que no es hora de vuelo; cambio de horario: se extrae el nuevo; el tramo reemplaza a uno ya dado de alta (IT-FR-1): actualizar, no duplicar
