import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Coupon } from './coupon.entity';
import { CreateCouponDto, ValidateCouponDto } from './dto';

@Injectable()
export class CouponsService {
  constructor(
    @InjectRepository(Coupon)
    private couponsRepository: Repository<Coupon>,
  ) {}

  private normalizeCode(code: string): string {
    const normalized = (code ?? '').toUpperCase();
    if (!/^[A-Z0-9_-]{4,20}$/.test(normalized)) {
      throw new BadRequestException(
        'Coupon code must be 4-20 characters and contain only letters, numbers, hyphens, or underscores',
      );
    }
    return normalized;
  }

  async create(dto: CreateCouponDto): Promise<Coupon> {
    const code = this.normalizeCode(dto.code);

    const existing = await this.couponsRepository.findOne({
      where: { code },
    });
    if (existing) {
      throw new BadRequestException('Coupon code already exists');
    }

    const coupon = this.couponsRepository.create({
      ...dto,
      code,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });
    return this.couponsRepository.save(coupon);
  }

  async generateBulk(
    prefix: string,
    count: number,
    discountType: 'percentage' | 'fixed',
    discountValue: number,
    expiresAt?: Date,
  ): Promise<Coupon[]> {
    const coupons = [];
    for (let i = 0; i < count; i++) {
      const code = `${prefix}-${Date.now()}-${i}`.toUpperCase();
      const coupon = this.couponsRepository.create({
        code,
        discountType,
        discountValue,
        expiresAt: expiresAt || null,
      });
      coupons.push(coupon);
    }
    return this.couponsRepository.save(coupons);
  }

  async validateForCheckout(
    code: string,
    priceUsd: number,
  ): Promise<{ valid: boolean; discount: number; discountType: 'percentage' | 'fixed' }> {
    const normalizedCode = (code ?? '').toUpperCase();
    const coupon = await this.couponsRepository.findOne({ where: { code: normalizedCode } });

    if (!coupon || !coupon.isActive) return { valid: false, discount: 0, discountType: 'fixed' };
    if (coupon.expiresAt && new Date() > coupon.expiresAt) return { valid: false, discount: 0, discountType: 'fixed' };
    if (coupon.maxUsage && coupon.usageCount >= coupon.maxUsage) return { valid: false, discount: 0, discountType: 'fixed' };

    const discount =
      coupon.discountType === 'percentage'
        ? (priceUsd * Number(coupon.discountValue)) / 100
        : Math.min(Number(coupon.discountValue), priceUsd);

    return { valid: true, discount, discountType: coupon.discountType };
  }

  async validate(dto: ValidateCouponDto): Promise<{ valid: boolean; discount: number }> {
    const code = this.normalizeCode(dto.code);
    const coupon = await this.couponsRepository.findOne({
      where: { code },
    });

    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }

    if (!coupon.isActive) {
      throw new BadRequestException('Coupon is inactive');
    }

    if (coupon.expiresAt && new Date() > coupon.expiresAt) {
      throw new BadRequestException('Coupon has expired');
    }

    if (coupon.maxUsage && coupon.usageCount >= coupon.maxUsage) {
      throw new BadRequestException('Coupon usage limit reached');
    }

    return {
      valid: true,
      discount: Number(coupon.discountValue),
    };
  }

  async incrementUsage(code: string): Promise<void> {
    await this.couponsRepository.increment(
      { code: (code ?? '').toUpperCase() },
      'usageCount',
      1,
    );
  }

  async findAll(): Promise<Coupon[]> {
    return this.couponsRepository.find();
  }

  async findById(id: string): Promise<Coupon> {
    const coupon = await this.couponsRepository.findOne({ where: { id } });
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }
    return coupon;
  }

  async update(id: string, dto: Partial<CreateCouponDto>): Promise<Coupon> {
    const coupon = await this.findById(id);
    Object.assign(coupon, dto);
    return this.couponsRepository.save(coupon);
  }

  async delete(id: string): Promise<void> {
    const result = await this.couponsRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException('Coupon not found');
    }
  }
}
