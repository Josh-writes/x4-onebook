/*
 * uzlib  -  tiny deflate/inflate library (deflate, gzip, zlib)
 *
 * Copyright (c) 2003 by Joergen Ibsen / Jibz
 * All Rights Reserved
 * http://www.ibsensoftware.com/
 *
 * Copyright (c) 2014-2018 by Paul Sokolovsky
 */

#include <assert.h>
#include <string.h>
#include "tinf.h"

#define RUNTIME_BITS_TABLES

uint32_t tinf_get_le_uint32(TINF_DATA *d);
uint32_t tinf_get_be_uint32(TINF_DATA *d);

#ifdef RUNTIME_BITS_TABLES
unsigned char length_bits[30];
unsigned short length_base[30];
unsigned char dist_bits[30];
unsigned short dist_base[30];
#else
const unsigned char length_bits[30] = {
   0, 0, 0, 0, 0, 0, 0, 0,
   1, 1, 1, 1, 2, 2, 2, 2,
   3, 3, 3, 3, 4, 4, 4, 4,
   5, 5, 5, 5
};
const unsigned short length_base[30] = {
   3, 4, 5, 6, 7, 8, 9, 10,
   11, 13, 15, 17, 19, 23, 27, 31,
   35, 43, 51, 59, 67, 83, 99, 115,
   131, 163, 195, 227, 258
};

const unsigned char dist_bits[30] = {
   0, 0, 0, 0, 1, 1, 2, 2,
   3, 3, 4, 4, 5, 5, 6, 6,
   7, 7, 8, 8, 9, 9, 10, 10,
   11, 11, 12, 12, 13, 13
};
const unsigned short dist_base[30] = {
   1, 2, 3, 4, 5, 7, 9, 13,
   17, 25, 33, 49, 65, 97, 129, 193,
   257, 385, 513, 769, 1025, 1537, 2049, 3073,
   4097, 6145, 8193, 12289, 16385, 24577
};
#endif

const unsigned char clcidx[] = {
   16, 17, 18, 0, 8, 7, 9, 6,
   10, 5, 11, 4, 12, 3, 13, 2,
   14, 1, 15
};

#ifdef RUNTIME_BITS_TABLES
static void tinf_build_bits_base(unsigned char *bits, unsigned short *base, int delta, int first)
{
   int i, sum;
   for (i = 0; i < delta; ++i) bits[i] = 0;
   for (i = 0; i < 30 - delta; ++i) bits[i + delta] = i / delta;
   for (sum = first, i = 0; i < 30; ++i) {
      base[i] = sum;
      sum += 1 << bits[i];
   }
}
#endif

static void tinf_build_fixed_trees(TINF_TREE *lt, TINF_TREE *dt)
{
   int i;
   for (i = 0; i < 7; ++i) lt->table[i] = 0;
   lt->table[7] = 24;
   lt->table[8] = 152;
   lt->table[9] = 112;
   for (i = 0; i < 24; ++i) lt->trans[i] = 256 + i;
   for (i = 0; i < 144; ++i) lt->trans[24 + i] = i;
   for (i = 0; i < 8; ++i) lt->trans[24 + 144 + i] = 280 + i;
   for (i = 0; i < 112; ++i) lt->trans[24 + 144 + 8 + i] = 144 + i;
   for (i = 0; i < 5; ++i) dt->table[i] = 0;
   dt->table[5] = 32;
   for (i = 0; i < 32; ++i) dt->trans[i] = i;
}

static void tinf_build_tree(TINF_TREE *t, const unsigned char *lengths, unsigned int num)
{
   unsigned short offs[16];
   unsigned int i, sum;
   for (i = 0; i < 16; ++i) t->table[i] = 0;
   for (i = 0; i < num; ++i) t->table[lengths[i]]++;
   t->table[0] = 0;
   for (sum = 0, i = 0; i < 16; ++i) {
      offs[i] = sum;
      sum += t->table[i];
   }
   for (i = 0; i < num; ++i) {
      if (lengths[i]) t->trans[offs[lengths[i]]++] = i;
   }
}

unsigned char uzlib_get_byte(TINF_DATA *d)
{
   if (d->source < d->source_limit) {
      return *d->source++;
   }
   if (d->source_read_cb && !d->eof) {
      int val = d->source_read_cb(d);
      if (val >= 0) {
         return (unsigned char)val;
      }
   }
   d->eof = true;
   return 0;
}

uint32_t tinf_get_le_uint32(TINF_DATA *d)
{
   uint32_t val = 0;
   int i;
   for (i = 4; i--;) {
      val = val >> 8 | ((uint32_t)uzlib_get_byte(d)) << 24;
   }
   return val;
}

uint32_t tinf_get_be_uint32(TINF_DATA *d)
{
   uint32_t val = 0;
   int i;
   for (i = 4; i--;) {
      val = val << 8 | uzlib_get_byte(d);
   }
   return val;
}

static int tinf_getbit(TINF_DATA *d)
{
   unsigned int bit;
   if (!d->bitcount--) {
      d->tag = uzlib_get_byte(d);
      d->bitcount = 7;
   }
   bit = d->tag & 0x01;
   d->tag >>= 1;
   return bit;
}

static unsigned int tinf_read_bits(TINF_DATA *d, int num, int base)
{
   unsigned int val = 0;
   if (num) {
      unsigned int limit = 1 << (num);
      unsigned int mask;
      for (mask = 1; mask < limit; mask *= 2)
         if (tinf_getbit(d)) val += mask;
   }
   return val + base;
}

static int tinf_decode_symbol(TINF_DATA *d, TINF_TREE *t)
{
   int sum = 0, cur = 0, len = 0;
   do {
      cur = 2*cur + tinf_getbit(d);
      if (++len == TINF_ARRAY_SIZE(t->table)) {
         return TINF_DATA_ERROR;
      }
      sum += t->table[len];
      cur -= t->table[len];
   } while (cur >= 0);
   sum += cur;
   return t->trans[sum];
}

static int tinf_decode_trees(TINF_DATA *d, TINF_TREE *lt, TINF_TREE *dt)
{
   unsigned char lengths[288+32];
   unsigned int hlit, hdist, hclen, hlimit;
   unsigned int i, num, length;

   hlit = tinf_read_bits(d, 5, 257);
   hdist = tinf_read_bits(d, 5, 1);
   hclen = tinf_read_bits(d, 4, 4);

   for (i = 0; i < 19; ++i) lengths[i] = 0;
   for (i = 0; i < hclen; ++i) {
      unsigned int clen = tinf_read_bits(d, 3, 0);
      lengths[clcidx[i]] = clen;
   }

   tinf_build_tree(lt, lengths, 19);

   hlimit = hlit + hdist;
   for (num = 0; num < hlimit; ) {
      int sym = tinf_decode_symbol(d, lt);
      unsigned char fill_value = 0;
      int lbits, lbase = 3;

      if (sym < 0) return sym;

      switch (sym) {
      case 16:
         if (num == 0) return TINF_DATA_ERROR;
         fill_value = lengths[num - 1];
         lbits = 2;
         break;
      case 17:
         lbits = 3;
         break;
      case 18:
         lbits = 7;
         lbase = 11;
         break;
      default:
         lengths[num++] = sym;
         continue;
      }

      length = tinf_read_bits(d, lbits, lbase);
      if (num + length > hlimit) return TINF_DATA_ERROR;
      for (; length; --length) {
         lengths[num++] = fill_value;
      }
   }

#if UZLIB_CONF_PARANOID_CHECKS
   if (lengths[256] == 0) {
      return TINF_DATA_ERROR;
   }
#endif

   tinf_build_tree(lt, lengths, hlit);
   tinf_build_tree(dt, lengths + hlit, hdist);

   return TINF_OK;
}

static int tinf_inflate_block_data(TINF_DATA *d, TINF_TREE *lt, TINF_TREE *dt)
{
   if (d->curlen == 0) {
      unsigned int offs;
      int dist;
      int sym = tinf_decode_symbol(d, lt);

      if (d->eof) {
         return TINF_DATA_ERROR;
      }

      if (sym < 256) {
         TINF_PUT(d, sym);
         return TINF_OK;
      }

      if (sym == 256) {
         return TINF_DONE;
      }

      sym -= 257;
      if (sym >= 29) {
         return TINF_DATA_ERROR;
      }

      d->curlen = tinf_read_bits(d, length_bits[sym], length_base[sym]);

      dist = tinf_decode_symbol(d, dt);
      if (dist >= 30) {
         return TINF_DATA_ERROR;
      }

      offs = tinf_read_bits(d, dist_bits[dist], dist_base[dist]);

      if (d->dict_ring) {
         if (offs > d->dict_size) {
            return TINF_DICT_ERROR;
         }
         d->lzOff = d->dict_idx - offs;
         if (d->lzOff < 0) {
            d->lzOff += d->dict_size;
         }
      } else {
         if (offs > (unsigned)(d->dest - d->dest_start)) {
            return TINF_DATA_ERROR;
         }
         d->lzOff = -offs;
      }
   }

   if (d->dict_ring) {
      TINF_PUT(d, d->dict_ring[d->lzOff]);
      if ((unsigned)++d->lzOff == d->dict_size) {
         d->lzOff = 0;
      }
   } else {
#if UZLIB_CONF_USE_MEMCPY
      unsigned int to_copy = d->curlen, dest_len = d->dest_limit - d->dest;
      if (to_copy > dest_len) {
         to_copy = dest_len;
      }
      memcpy(d->dest, d->dest + d->lzOff, to_copy);
      d->dest += to_copy;
      d->curlen -= to_copy;
      return TINF_OK;
#else
      d->dest[0] = d->dest[d->lzOff];
      d->dest++;
#endif
   }
   d->curlen--;
   return TINF_OK;
}

static int tinf_inflate_uncompressed_block(TINF_DATA *d)
{
   if (d->curlen == 0) {
      unsigned int length, invlength;
      length = uzlib_get_byte(d);
      length += 256 * uzlib_get_byte(d);
      invlength = uzlib_get_byte(d);
      invlength += 256 * uzlib_get_byte(d);
      if (length != (~invlength & 0x0000ffff)) return TINF_DATA_ERROR;
      d->curlen = length + 1;
      d->bitcount = 0;
   }

   if (--d->curlen == 0) {
      return TINF_DONE;
   }

   unsigned char c = uzlib_get_byte(d);
   TINF_PUT(d, c);
   return TINF_OK;
}

void uzlib_init(void)
{
#ifdef RUNTIME_BITS_TABLES
   tinf_build_bits_base(length_bits, length_base, 4, 3);
   tinf_build_bits_base(dist_bits, dist_base, 2, 1);
   length_bits[28] = 0;
   length_base[28] = 258;
#endif
}

void uzlib_uncompress_init(TINF_DATA *d, void *dict, unsigned int dictLen)
{
   d->eof = 0;
   d->bitcount = 0;
   d->bfinal = 0;
   d->btype = -1;
   d->dict_size = dictLen;
   d->dict_ring = dict;
   d->dict_idx = 0;
   d->curlen = 0;
}

int uzlib_uncompress(TINF_DATA *d)
{
   do {
      int res;
      if (d->btype == -1) {
         int old_btype;
      next_blk:
         old_btype = d->btype;
         d->bfinal = tinf_getbit(d);
         d->btype = tinf_read_bits(d, 2, 0);

         if (d->btype == 1 && old_btype != 1) {
            tinf_build_fixed_trees(&d->ltree, &d->dtree);
         } else if (d->btype == 2) {
            res = tinf_decode_trees(d, &d->ltree, &d->dtree);
            if (res != TINF_OK) {
               return res;
            }
         }
      }

      switch (d->btype) {
      case 0:
         res = tinf_inflate_uncompressed_block(d);
         break;
      case 1:
      case 2:
         res = tinf_inflate_block_data(d, &d->ltree, &d->dtree);
         break;
      default:
         return TINF_DATA_ERROR;
      }

      if (res == TINF_DONE && !d->bfinal) {
         goto next_blk;
      }
      if (res != TINF_OK) {
         return res;
      }
   } while (d->dest < d->dest_limit);

   return TINF_OK;
}

int uzlib_uncompress_chksum(TINF_DATA *d)
{
   int res;
   unsigned char *data = d->dest;
   res = uzlib_uncompress(d);
   if (res < 0) return res;

   switch (d->checksum_type) {
   case TINF_CHKSUM_ADLER:
      d->checksum = uzlib_adler32(data, d->dest - data, d->checksum);
      break;
   case TINF_CHKSUM_CRC:
      d->checksum = uzlib_crc32(data, d->dest - data, d->checksum);
      break;
   }

   if (res == TINF_DONE) {
      unsigned int val;
      switch (d->checksum_type) {
      case TINF_CHKSUM_ADLER:
         val = tinf_get_be_uint32(d);
         if (d->checksum != val) {
            return TINF_CHKSUM_ERROR;
         }
         break;
      case TINF_CHKSUM_CRC:
         val = tinf_get_le_uint32(d);
         if (~d->checksum != val) {
            return TINF_CHKSUM_ERROR;
         }
         val = tinf_get_le_uint32(d);
         break;
      }
   }
   return res;
}

int uzlib_zlib_parse_header(TINF_DATA *d) {
    int cmf = uzlib_get_byte(d);
    int flg = uzlib_get_byte(d);
    if (cmf == -1 || flg == -1) return TINF_DATA_ERROR;
    if ((cmf * 256 + flg) % 31 != 0) return TINF_DATA_ERROR;
    if ((cmf & 15) != 8) return TINF_DATA_ERROR;
    return 0;
}

int uzlib_gzip_parse_header(TINF_DATA *d) {
    int method = uzlib_get_byte(d);
    int flags = uzlib_get_byte(d);
    if (method == -1 || flags == -1) return TINF_DATA_ERROR;
    if (method != 8) return TINF_DATA_ERROR;
    if (flags & 0xE0) return TINF_DATA_ERROR;
    for (int i = 0; i < 6; i++) uzlib_get_byte(d);
    if (flags & 2) uzlib_get_byte(d);
    if (flags & 4) uzlib_get_byte(d);
    if (flags & 8) { int c; while ((c = uzlib_get_byte(d)) != 0); }
    return 0;
}

static const uint32_t crc_table[256] = {
    0x00000000, 0x77073096, 0xee0e612c, 0x990951ba, 0x076dc419, 0x706af48f, 0xe963a535, 0x9e6495a3,
    0x0edb8832, 0x79dcb8a4, 0xe0d5e91e, 0x97d2d988, 0x09b64c2b, 0x7eb17cbd, 0xe7b82d07, 0x90bf1d91,
    0x1db71064, 0x6ab020f3, 0xf3b97148, 0x84be41de, 0x1adad47d, 0x6ddde4eb, 0xf4d4b551, 0x83d385c7,
    0x136c9856, 0x646ba8c0, 0xfd62f97a, 0x8a65c9ec, 0x14015c4f, 0x63066cd9, 0xfa0f3d63, 0x8d080df5,
    0x3b6e20c8, 0x4c69105e, 0xd56041e4, 0xa2677172, 0x3c03e4d1, 0x4b04d447, 0xd20d85fd, 0xa50ab56b,
    0x35b5a8fa, 0x42b2986c, 0xdbbbbcd6, 0xac9bc3d4, 0x32d86ce3, 0x45df5c75, 0xdcd60dcf, 0xabd13d59,
    0x26d930ac, 0x51de003a, 0xc8d75180, 0xbfd06116, 0x21b4f4b5, 0x56b3c42c, 0xcfba9599, 0xb8bda50f,
    0x2802b89e, 0x5f058808, 0xc60cd9b2, 0xb10be924, 0x2f6f7c87, 0x58684c11, 0xc1611dab, 0xb6662d3d,
    0x76dc4190, 0x01db7106, 0x98d220bc, 0xefd5102a, 0x71b18589, 0x06b6b51f, 0x9fbfe4a5, 0xe8b8d433,
    0x7807c9a2, 0x0f00f934, 0x9609a88e, 0xe10e9818, 0x7f6a0dbb, 0x086d3d2d, 0x91646c97, 0xe6635c01,
    0x6b6b51f4, 0x1c6c6162, 0x856530d8, 0xf262004e, 0x6c0695ed, 0x1b01a57b, 0x8208f4c1, 0xf50fc457,
    0x65b0d9c6, 0x12b7e950, 0x8bbeb8ea, 0xfcb9887c, 0x62dd1ddf, 0x15da2d49, 0x8cd37cf3, 0xfbd44c65,
    0x4db26158, 0x3ab551ce, 0xa3bc0074, 0xd4bb30e2, 0x4adfa541, 0x3dd895d7, 0xa4d1c46d, 0xd3d6f4fb,
    0x4369e96a, 0x346ed9fc, 0xad678846, 0xda60b8d0, 0x44042d73, 0x33031de5, 0xaa0a4c5f, 0xdd0d7cc9,
    0x5005713c, 0x270241aa, 0xbe0b1010, 0xc90c2086, 0x5768b525, 0x206f85b3, 0xb966d409, 0xce61e49f,
    0x5edef90e, 0x29d9c998, 0xb0d09822, 0xc7d7a8b4, 0x59b33d17, 0x2eb40d81, 0xb7bd5c3b, 0xc0ba6cad,
    0xedb88320, 0x9abfb3b6, 0x03b6e20c, 0x74b1d29a, 0xead54739, 0x9dd277af, 0x04db2615, 0x73dc1683,
    0xe3630b12, 0x94643b84, 0x0d6d6a3e, 0x7a6a5aa8, 0xe40ecf0b, 0x9309ff9d, 0x0a00ae27, 0x7d079eb1,
    0xf00f9344, 0x8708a3d2, 0x1e01f268, 0x6906c2fe, 0xf762575d, 0x806567cb, 0x196c3671, 0x6e6b06e7,
    0xfed41b76, 0x89d32be0, 0x10da7a5a, 0x67dd4acc, 0xf9b91df6, 0x2cc1c9e7, 0x2d02e250, 0x8c24d5b,
    0x2d02e250
};

uint32_t uzlib_crc32(const void *data, unsigned int length, uint32_t crc)
{
    const uint8_t *p = (const uint8_t *)data;
    while (length--) {
        crc = crc_table[(crc ^ *p++) & 0xff] ^ (crc >> 8);
    }
    return crc;
}

static const uint32_t adler_table[4096] = {
    0x00000001, 0x00000000,
};

static uint32_t adler32_combine(uint32_t a, uint32_t b, int len) {
    return (a + b) % 65521;
}

uint32_t uzlib_adler32(const void *data, unsigned int length, uint32_t prev_sum)
{
    const uint8_t *p = (const uint8_t *)data;
    uint32_t a = prev_sum & 0xFFFF;
    uint32_t b = prev_sum >> 16;
    while (length--) {
        a = (a + *p++) % 65521;
        b = (b + a) % 65521;
    }
    return (b << 16) | a;
}